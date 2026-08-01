# Platform Toolkit

Open-source tools for powerlifters and meet directors. Each one works on its own, and any site may
embed a single tool without taking the rest.

**Status: early development.** Nothing is deployed yet.

## The tools

### Platform Targets

Powerlifting classification, record, and meet-qualification targets on one screen.

A lifter deciding what to attempt, and a meet director checking whether a registration is valid, are
both doing the same job today: opening half a dozen pages and correlating them by hand. Sex,
drug-tested status, equipment category, weight class, age division, state and national and world
records, classification standards, qualification windows, and prior results all live apart. This
puts them together, and shows the distance to the next thing worth chasing.

Two ways in, one model out:

- **Choose manually** — sex, equipment, weight class, age division, tested status.
- **Import a public OpenPowerlifting profile** — the same fields, filled in from real results.

Import assists; it never takes over. Every imported value stays editable, and the manual path works
on its own.

From there it shows current classification, the exact gap to the next one, applicable records at
state, national, and IPL World level, and whether a chosen meet's published criteria are met — per
discipline, and per equipment category.

## Architecture

Static site, no backend. GitHub Actions fetches every source on a schedule, validates and normalizes
it, and publishes plain JSON to GitHub Pages. The browser reads that JSON and runs every calculation
locally.

That is a deliberate trade. No server means no database to operate, no API to version, no
credentials to hold, and no request path that can be pointed at an attacker-chosen URL. Every source
is public, so the safest secret is the one that does not exist.

```
apps/web/                 The deployed site. One Vite MPA, one page entry per route.
  index.html                the tool index
  platform-targets/         one directory per tool: standalone page and embed routes
packages/domain/          Pure calculation. No DOM, no network, no I/O.
packages/data-contracts/  Runtime schemas and types for every published artifact
packages/ingestion/       Source adapters and anomaly checks. CI only.
packages/configuration/   Defaults, theme configuration, precedence resolution
packages/ui/              Shared custom elements and design tokens. The only DOM package.
data/                     Reviewed rule files, fixtures, change-detection state
docs/                     ADRs, source notes, embedding and operations guides
```

Data arrives from outside the program, so it is validated on read with a runtime schema, not
assumed. A source that changes shape produces a visible status, never a silently coerced number.

### Why one repository

The published dataset is the deciding constraint. The OpenPowerlifting mirror is several hundred
megabytes, GitHub Pages allows one site per repository and caps a site at 1 GB, so a repository per
tool would mean either duplicating the mirror per site — which exhausts the cap after two or three
tools — or serving it from a separate origin, which forces `connect-src` to name an external host
instead of `'self'`.

Independent embedding does not require separate repositories. It is a property of the routes: each
tool has its own page entries, so a page loads only the tool it is showing, and embedding one tool
ships none of the others. The honest cost of one repository is that a deploy publishes everything at
once, with no per-tool rollback.

Every page links to its siblings with relative URLs and the build takes its base path from
`PTK_BASE_PATH`, so moving to a subpath, a custom domain, or a different static host is
configuration rather than a rewrite.

## Requirements

Node 24 (`.nvmrc` pins it; `nvm use` picks it up) and pnpm.

The pnpm version is pinned by the `packageManager` field, so you do not install it separately —
`corepack enable pnpm` once, and Node fetches the exact pinned version on first use. CI reads the
same field, which is what keeps the two from drifting.

pnpm is a security choice more than an ergonomic one. Dependency lifecycle scripts do not run unless
the package is named in `pnpm-workspace.yaml`, and the list here is empty, so installing this project
executes no third-party code — on a contributor's machine or in the workflow that publishes the
site. A package that is not declared as a dependency also cannot be imported, which is what keeps
the boundary between the pure packages and the one DOM package real rather than conventional. Unmet
peer dependencies are configured to fail the install rather than warn.

## Getting started

```sh
corepack enable pnpm  # once per machine
pnpm install          # also points git at .githooks
pnpm dev              # the whole site: tool index and every tool
pnpm verify           # format, typecheck, lint, test, reference scan, build
```

| Script                 | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `pnpm dev`             | Vite dev server                               |
| `pnpm build`           | Production build of every workspace           |
| `pnpm typecheck`       | Packages, tests, and build config             |
| `pnpm lint`            | ESLint, type-aware                            |
| `pnpm format`          | Prettier, write                               |
| `pnpm test`            | Vitest, one project per package               |
| `pnpm scan:references` | Commit-identity and forbidden-reference check |

`verify` runs `typecheck` before `lint` deliberately. Type-aware lint rules read the declaration
output of referenced projects, so linting a package that has never been built reports its imports as
unresolved rather than reporting anything useful.

## Embedding

The tools are meant to be embedded. Any site may frame one, and nothing needs to be configured to
allow it.

```html
<iframe
  src="https://example.invalid/platform-targets/embed/uspa/?theme=dark"
  title="Platform Targets"
></iframe>
```

Framing grants the parent page no access to application data and no control over it. Theme and
defaults are set through documented query parameters. Inbound `postMessage` payloads are
origin-checked and schema-validated, and no arbitrary URL, CSS, HTML, or script is ever accepted
from a parent. The only message sent outward is the content height, which is a layout measurement
and contains nothing else — imported athlete information is never transmitted to a parent. That
message names both the collection and the tool, so a page embedding two tools can tell them apart
rather than sizing both frames to whichever spoke last.

The federation is a path segment rather than a query parameter, so each federation's rules get their
own cacheable URL and an embedding site cannot silently switch which rules a reader is looking at.

## Theming

Three modes: `system`, `light`, `dark`. The configured mode and the resulting theme are kept
distinct throughout — `system` is a real choice, not a synonym for whichever theme it resolves to.

Precedence, highest first: host lock, then stored user preference, then host default, then `system`.
A host that locks the theme cannot have that lock overridden by a stored preference or by a message.

There is no theme flash. `system` is handled entirely by `prefers-color-scheme` in CSS, so the
common case involves no JavaScript at all; a forced theme is applied by a small external script
before first paint, external so that a strict `script-src 'self'` policy still covers it.

Because every tool is served from one origin, a preference chosen in one tool applies to all of
them.

## Privacy

Imported athlete data and profile URLs are not persisted by default. Athlete names and full profile
URLs are kept out of logs, and athlete identity is never included in error reports.

## Data sources

All public. Source, retrieval time, and revision are recorded for every artifact and surfaced in the
app, per tier — a state record and a national record can differ in age, and showing one timestamp
for both would misrepresent the newer one.

Competition results come from the OpenPowerlifting bulk dataset, which carries a public-domain
waiver. Only its published data is consumed; none of its application code is used.

## Contributing

Run `pnpm verify` before opening a pull request. Commit under your own name and email — the project
imposes no identity requirement on contributors.

`pnpm scan:references` checks tracked content, file paths, and commit metadata against a list of
strings that must not appear in this repository. That list is deliberately **not** committed, in
plaintext or as digests: the tokens are short enough that a wordlist recovers them from hashes in
seconds, so a committed digest list is a committed list. Supply it locally through an untracked
`.prohibited-tokens.local` file or a `PTK_PROHIBITED_TOKENS` environment variable. With neither
present the scan reports "skipped" and passes, which is the expected result for most people.

A maintainer whose machine has a work email configured globally can add an untracked
`.commit-identity.local` holding one exact address; the pre-commit hook then requires that address
and a signed commit **on that machine only**. Both files are gitignored and absent from a clone, so
a fresh checkout enforces nothing.

## License

[MIT](LICENSE)
