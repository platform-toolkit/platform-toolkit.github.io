# Governance

## The short version

One maintainer, Jason Smathers, makes the decisions. Decisions are made in public, with reasons
given. There is no committee, no voting, and no pretence otherwise.

This document exists so that nobody has to guess how a contribution will be handled, and so that the
arrangement above is a stated one rather than a thing you work out after your pull request has been
open for a month.

## Roles

**Maintainer.** Merges changes, cuts releases, decides scope, and is accountable for everything the
project publishes. Currently one person.

**Contributor.** Anyone who opens an issue or a pull request. No status is required and none is
conferred.

**Committer.** Does not exist yet. If the project grows enough to need one, the route is described
below rather than invented at the time.

## How a change is decided

1. Open an issue first for anything larger than a bug fix. A pull request that arrives without one
   may be turned down on grounds of scope after you have already written it, which wastes your
   evening and is avoidable.
2. The maintainer responds with one of: yes, yes-with-changes, not yet, or no.
3. A "no" comes with a reason. A pull request that is not going to be merged gets closed and told
   so, rather than left open indefinitely. Silence is a failure of this process, not a form of
   rejection.
4. Merged changes require `pnpm run verify` to pass and a review by the maintainer.

The maintainer's own changes go through the same automated gates. They do not go through a second
reviewer, because there is not one. That is a real limitation of a single-maintainer project and is
stated here rather than papered over.

## What is in scope

- Tools that answer a concrete question for a powerlifter, coach or meet director.
- Correctness, accessibility, offline behaviour, and performance on a mid-range phone.
- Federation data, encoded independently from public sources with provenance.
- Making the tools easier for other people to reuse: embedding, packages, documentation.

## What is out of scope

- Accounts, servers, or anything that stores a person's data off their own device.
- Advertising, third-party analytics, trackers, or engagement mechanics.
- Coaching content, programme prescription presented as instruction, or medical advice.
- Presenting the toolkit as affiliated with, endorsed by, or equivalent to any federation, gym,
  certification body or training system. It is none of those things and will not imply that it is.
- Any framework or library on the refused list in the README.

## Becoming a maintainer

There is no application. The path is a track record: several substantial merged contributions,
review comments that improve other people's changes, and a demonstrated interest in the parts of the
work nobody enjoys — the data provenance, the accessibility passes, the tests for the failure cases.
If that describes you, the maintainer will raise it with you.

Adding a maintainer is a decision the current maintainer makes, publicly, recorded in this file.

## Releases

The site at <https://platform-toolkit.github.io> deploys from `main` when CI is green. There is no
separate release branch.

npm packages, when published, are versioned independently and follow semantic versioning. A
published package's public API is a promise; breaking it requires a major version.

Data is versioned separately from code. Published artifacts carry the date each figure was
retrieved, and the application shows that date rather than the deploy date, because the two are
different facts and only one of them is about whether a number is current.

## Licensing decisions

The project is licensed under the [Apache License 2.0](LICENSE). Contributions are
inbound-equals-outbound under the same terms, certified by the [DCO](DCO.md).

Because there is no copyright assignment and no CLA, the maintainer cannot unilaterally relicense
contributed code. A future relicensing would require the agreement of everyone whose copyright is
involved, and would apply prospectively — a release already published under a licence stays
published under it. That is a deliberate constraint on the maintainer's own authority, and it is the
reason this project does not ask for a CLA.

## Conflicts of interest

The maintainer may build commercial software that consumes these packages. That is permitted by the
Apache License for anyone, including the maintainer, and the project would rather say so than have
it discovered.

The obligation it creates is one-directional: nothing may be removed from, crippled in, or withheld
from the open-source tools to make a paid product more attractive. No feature gates, no deliberately
worse defaults, no telemetry added for commercial benefit. If a change to this repository only makes
sense in light of something outside it, that is a change this project should not accept — from
anyone, the maintainer included.

## Changing this document

By pull request, like anything else. Changes to governance are announced in
[CHANGELOG.md](CHANGELOG.md) rather than merged quietly.
