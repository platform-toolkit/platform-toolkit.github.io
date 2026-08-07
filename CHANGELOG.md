# Changelog

Notable changes to Platform Toolkit. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The deployed site tracks `main` and has no version number of its own, so entries here are grouped by
date rather than by release tag. Published npm packages, when they exist, will be versioned
independently and follow semantic versioning.

## Unreleased

### Status

Seven tools ship. The site is live at <https://platform-toolkit.github.io> and tracks `main`.

**This is an early experimental release.** What that means concretely, rather than as a disclaimer:

- **Stored data is not yet stable.** Every tool that remembers something keeps it in the browser
  that saved it, and the shape of what is stored may change without a migration until a stable data
  version is declared. Anything you would be sorry to lose should be exported — the Training Logbook
  and the Meet Day Planner both download their whole record as a file.
- **Published artifacts may change shape.** The JSON under `/data/` is validated on read, so a
  change produces a visible status rather than a wrong number, but nothing outside this repository
  should depend on its layout yet.
- **No package is published to npm.** The packages are installable in shape — `files`, `prepack`,
  peer dependencies and per-package licences are all in place and gated — but they remain `private`
  at `0.0.0`, so consuming one today means consuming this repository.
- **Coverage is uneven by design.** Platform Targets does not yet import a lifter's profile;
  Qualification Check is where that landed first. Qualification Check reads a meet's published
  criteria only for meets that have been transcribed. Federation coverage is USPA for categories,
  classifications, records and qualification — IPL World records arrive inside USPA's own book — and
  USPA plus IPF for the bar and plate rules the Meet Day Planner loads against.
- **Nothing here decides anything.** No tool rules on eligibility, prescribes training, or labels an
  attempt safe. Where an answer is not knowable from published figures, the tools say so in those
  words instead of guessing.

### Changed

- **The project is now licensed under the Apache License 2.0.** It was previously MIT. The change is
  prospective: everything published up to and including the `mit-final` tag was released under MIT
  and stays available under MIT permanently. From that point forward, first-party toolkit software
  is Apache-2.0.

  Apache-2.0 was chosen for what MIT does not say. It grants a patent licence explicitly (section 3)
  and terminates it for anyone who sues over the software (section 3, final sentence), which matters
  to organisations that would otherwise need a legal review before embedding a widget. It also
  states its attribution requirements precisely enough to comply with mechanically, which is why the
  repository can now enforce them.

  Nothing about how you may use the tools has become more restrictive.

- Contributions are certified under the [Developer Certificate of Origin 1.1](DCO.md) with
  `git commit -s`. There is no contributor licence agreement and no copyright assignment;
  contributors keep their copyright, and no maintainer can relicense their work without asking them.

### Added

- `NOTICE`, [`CONTRIBUTING.md`](CONTRIBUTING.md), [`GOVERNANCE.md`](GOVERNANCE.md),
  [`SECURITY.md`](SECURITY.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md),
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), [`DCO.md`](DCO.md) and this changelog.
- A copyright and `SPDX-License-Identifier` header on every first-party source file, enforced by
  `pnpm run check:licenses`.
- A dependency-licence gate. `scripts/check-dependency-licenses.mjs` runs in `verify` and fails the
  build on an unaccepted, unrecognised or missing licence — and on a build-tooling-only licence that
  turns up in the production closure. The full inventory is committed at
  [`docs/dependency-licenses.md`](docs/dependency-licenses.md).
- A deterministic CycloneDX SBOM (`pnpm run sbom`), which records for each component whether it
  reaches a user or exists only to build the repository.

### Platform Targets

The tool was rebuilt around the report rather than around the form. The unit of presentation is now
one lift, one target type, one compact matrix, with the exact number first.

- Setup asks its questions once and then gets out of the way; the chosen context collapses to an
  editable summary line.
- Age division is optional and never replaces Open — the Open figures are always shown alongside.
  Two weight classes can be compared at once. Records appear as soon as sex, equipment, tested
  status and one weight class are known; everything else adds detail without blocking the report.
- Records show in kilograms and pounds, at every level the selections reach, with a link back to the
  table the federation publishes each one in.
- Record targets state what it actually takes to take the record — a 0.5 kg chip when the record is
  at or above the meet's level, a full 2.5 kg when it is below. Kilograms are authoritative; a
  published pound figure is a conversion and is never used to compute a target.
- A lifter can commit to a target and see the exact remaining gap.
- The report says how old its numbers are, states plainly when the device is offline or a refresh
  failed, and offers a retry that restarts every stalled load.

### Warm-Up Calculator

A warm-up ramp for a working weight, on the plates in front of you rather than a percentage table
rounded by hand. Each set shows its loading plate by plate and per side, and sets are ticked off as
they are taken. A working weight the bar cannot be loaded to is reported as exactly that, with the
nearest loadable weight either side, and is never silently moved to one of them. The rack and plates
are remembered; a half-finished ramp is not, because reopening one next week would present scratch
state as a training record.

### Pounds and Kilograms

The exact conversion and the federation's published chart figure, kept apart and labelled. The chart
figure leads, because that is the one that governs an attempt — a lifter who submits the exact
arithmetic has submitted a weight the table does not contain. No chart row is ever generated: a
weight between two published rows produces the rows either side, measured in the column the weight
was stated in. Barbell milestones are listed in the unit being converted to, with their loading
assumptions stated.

### One-Rep Max Estimator

A conservative, a middle and an optimistic figure from the published equations, each rounded to a
loadable step, with every equation listed underneath — its notation, its citation, what it answered,
and why it did or did not contribute. Equations that are the same relationship under two names get
one vote between them.

The optional questions change the grade of the estimate rather than the figure, and the tool opens
on the answer that claims least. Reported sex is the one that also touches the arithmetic, and only
for the bench press and the squat, because two of the underlying studies reported men and women
separately; declining it is a supported answer. The spread between equations is disagreement between
published models — not a confidence interval, not a margin of error, and not an opener.

### Meet Day Planner

Nine attempts checked against what the federation's bar and plates can actually be loaded to, then
run live on the day. Attempts are submitted, taken and marked good or no lift, the next is chosen
against what has happened rather than against the plan, and every change can be undone whole-world,
because a mis-tap during a flight is not the moment to edit state carefully. A coach gets one board
for a whole squad, each lifter with their own ramp timed to their own flight. The Meet Pack prints,
for the room where the phone is in a bag on the other side of the venue.

Nothing about a meet leaves the device.

### Qualification Check

A lifter's published results read against a meet's published entry criteria — classification per
lift and on the total, drug-tested status, the window each result falls inside, and each of a
transcribed meet's routes with the sentence it was read from beside it.

A route that does not open until a published day now reads as not yet open until that day, and any
condition attached to it is quoted rather than judged. Whether a place frees up is a fact about a
roster, and there is no roster here.

**It does not tell anybody whether they may enter a meet.** Where the answer is not knowable from
published figures, the reading says so. Two people under one name is ordinary, so the tool always
asks which and never picks — not even when the archive returns exactly one lifter. A pasted profile
link is reduced to the name in it before anything else happens; the tool does not fetch an address
somebody handed it.

### Training Logbook

Plan a session, tick the sets off as they are taken, correct what differed from the plan. Describe
the gym once and every set draws its own per-side loading; a session already worked out in the
Warm-Up Calculator carries straight across. The record reads back — a past session opens for
correction, the logging screen shows what the same lift did last time, every lift has a history with
its heaviest days marked, and any past session can be repeated as today's plan.

Nothing leaves the device: no account, no server, no sync, no telemetry. Training leaves as a JSON
file the lifter downloads. **Every screen says whether the browser is really keeping it**, because a
browser can refuse storage to a page, and that is better read before anything is typed than
discovered when a block of training is gone.

The history list is what has already been done. The session in progress is no longer in it — the
home screen already offers to resume that one — and neither is a session that was thrown away.

**It does not coach.** A missed set is recorded and not scored, an effort rating is stored and not
interpreted, and nothing derives a programme from a history.

### Distribution and hardening

- **Every package installs outside this workspace.** Lit was an exact dependency in three of them,
  so a consumer with their own copy would have got two Lit versions and two custom-element
  registries — a silent registration conflict rather than a build error. It is a peer dependency
  now. Three packages would have published their sources, build info and tests; each declares
  `files` and is checked by packing it. Each carries its own licence, because a tarball is extracted
  without the repository around it.
- **An embedded tool's frame no longer ratchets upward.** The published height was `scrollHeight`,
  which is `max(content, viewport)` — and inside a frame the viewport is the frame, so the
  measurement could never report less than the height the embedder had already set, and a tool that
  shrank left a permanent gap. It is measured once now, from the border box.
- **The web manifest no longer declares an `id`.** An `id` resolves against the origin while
  `start_url` resolves against the manifest URL, so no value of it can name a subpath, and a subpath
  deployment claimed whatever else was installed at the host's root.
- **An unresolvable address, and any navigation with no network, now answer with a real page**
  rather than the browser's offline screen.
- **Accessibility work on the Training Logbook.** Changing screen used to destroy focus: a keyboard
  landed back at the top of the document and a screen reader was told nothing had happened. A screen
  change now lands focus on the region it changed to, and ticking a set off keeps focus on the
  control that replaced the one pressed. Regions that announce a result are in the document from
  first paint, because one built at the moment it has something to say is announced by about half
  the engines. The tool carries its own top-level heading so an embedded copy is not a document
  without one, and drops it on a page that already has one.
- **Every package and the site itself now has a README**, and two claims in the root README that the
  code did not support are gone. The embeddable surface has exactly one query parameter, `theme`.
- **A published package now contains only what a consumer runs.** Tests were being compiled into
  `dist` and then filtered back out by a packing rule; they are no longer built. Declaration and
  source maps are off for the packed projects, because a tarball carries no `src` and a map that
  names `../src/index.ts` points at a path the consumer does not have.
- **An embedding page can validate the height message it receives** without a validation library of
  its own. The schema was published and the reader was not, which left every embedder to write one —
  and a page hears everything posted to it, so that reader is a trust boundary.
- **The offer to install is on every tool page**, not only the hub: arriving on a tool by a shared
  link is the ordinary case, and those visitors were offered nothing. It stays off the embed routes,
  where the page belongs to somebody else, and off the printed page.
- **The not-found page follows the deployment.** Its link home was absolute, so under a subpath
  deployment it sent a visitor who was already lost to the wrong site.
- **A logbook that cannot read its own history now says so**, instead of painting a blank screen
  over the one control — the JSON backup — that somebody with a failing database would reach for. A
  boot read the lifter has already overtaken is discarded rather than landing on top of the session
  they just planned, and exporting a long history no longer feeds every session to every exercise.

## Earlier

Development history before this changelog began is in the git log. The `mit-final` tag marks the
last commit published under the MIT License.
