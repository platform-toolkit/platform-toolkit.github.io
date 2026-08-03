# Contributing

Thank you for looking. This is a small project with one maintainer, so the process is short and the
expectations are written down rather than implied.

## What this project is for

Tools that answer a specific question a powerlifter or a meet director actually has, correctly, on a
phone, in a gym, possibly with no signal. Every tool works on its own, embeds in any site, and
stores nothing about anybody on a server.

A contribution that makes one of those things more true is very welcome. A contribution that trades
one of them away for a feature is a harder sell, and worth opening an issue about before you write
it.

## Licence and sign-off

Contributions are accepted under the [Apache License 2.0](LICENSE) — the same terms the project
distributes under. You keep the copyright in your work. There is no contributor licence agreement
and no copyright assignment.

Every commit must carry a `Signed-off-by` line certifying the
[Developer Certificate of Origin](DCO.md):

```
git commit -s -m "Your message"
```

New source files need the two-line header the rest of the repository carries:

```
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0
```

`pnpm run licenses:headers` inserts it for you, and `pnpm run verify` fails if a file is missing it.
If you would rather your own copyright line appear on files you author, say so in the pull request —
that is reasonable and the project will accommodate it.

## Disclosing AI assistance

If a language model materially wrote or restructured what you are submitting, say so in the pull
request description. One sentence is enough; there is no approval step and no stigma attached.

The reason is the certification above, not suspicion. Clause (a) of the DCO asks you to certify that
you have the right to submit the work, and generated code can reproduce training data you have not
seen and cannot license. Saying where the code came from tells a reviewer what to look at.
Assistance with tests, comments, prose and refactoring is entirely ordinary and needs no ceremony —
disclose when a model produced the substance of the change.

This applies to outside contributions. The maintainer's own use of tooling is covered by the same
duty of care, discharged by review rather than by annotating his own commits.

## Before you open a pull request

```
pnpm install
pnpm run verify
```

`verify` runs formatting, CSS template checks, four TypeScript projects, lint, the whole test suite,
the invisible-character scan, the reference scan, the dependency-licence and header gates, a
production build, a narrow-layout sweep at 320–430 px, the offline and installability checks, and a
Storybook smoke build. It takes a few minutes and it is the same thing CI runs. Running one
package's tests during development is fine; run the whole thing once before you push.

Commit under your own name and email. The project imposes no identity requirement on contributors,
and the repository's optional local hooks are absent from your clone.

## Adding a dependency

Think twice, then check the licence. The accepted set is MIT, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0 and public domain. MPL-2.0 is accepted for build tooling
only and never in the production closure. Anything copyleft that reaches shipped code, anything
source-available, anything with a non-commercial clause, and anything with no licence at all is
refused.

`pnpm run check:licenses` enforces this and runs in `verify`, so an unacceptable transitive
dependency fails your build rather than someone else's. After a dependency change, regenerate the
report with `pnpm run licenses:report` and commit it. If your dependency is shipped rather than
build-only, add its attribution to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The banned technologies are listed in the README's requirements section and are not negotiable: no
application framework, no general-purpose CSS framework, no large state-management library.

## Contributing data

Federation records, classification standards and rule details are facts, and this repository encodes
them independently from publicly available sources. If you are correcting or extending one:

- Cite where the figure is published, and record the retrieval date. Provenance lives in
  `data/sources/`.
- Transcribe facts. Do not copy pages, tables, artwork, prose or software.
- Do not work around a paywall, a login, a CAPTCHA or a robots restriction to obtain something. If a
  source is not publicly reachable, it is not a source this project can use.
- Kilograms are authoritative. A pound figure a federation publishes is a conversion and must not be
  used to compute anything.

Numbers in tests are invented fixtures, deliberately. Do not "fix" a test by replacing them with
real federation figures.

## House conventions

The code has strong opinions and they are documented where they apply, in comments next to the thing
they constrain. A few that catch everyone once:

- Comments explain **why**, not what. A comment restating the code will be asked about in review.
- Write `--` for a dash in source comments. Literal typographic characters are rejected by
  `check:text`.
- Never `@ts-ignore`, `@ts-nocheck`, a broad `any`, a silent schema coercion, or an unexplained lint
  suppression.
- Never catch an error and discard it.
- Web components use plain class fields with decorators, never the `accessor` keyword.
- Tap targets are at least 44 px, no input font is under 16 px, and layout uses container queries
  rather than viewport media queries.

## Reporting a security problem

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part is covered by the [Code of Conduct](CODE_OF_CONDUCT.md). Read it; it is short.

## How decisions get made

See [GOVERNANCE.md](GOVERNANCE.md). Briefly: one maintainer decides, in public, with reasons, and
says no clearly rather than letting a pull request rot.
