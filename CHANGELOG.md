# Changelog

Notable changes to Platform Toolkit. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The deployed site tracks `main` and has no version number of its own, so entries here are grouped by
date rather than by release tag. Published npm packages, when they exist, will be versioned
independently and follow semantic versioning.

## Unreleased

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

## Earlier

Development history before this changelog began is in the git log. The `mit-final` tag marks the
last commit published under the MIT License.
