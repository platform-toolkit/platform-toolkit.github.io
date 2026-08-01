# Platform Toolkit

Open-source tools for powerlifters and meet directors. Each one works on its own, and any site may
embed a single tool without taking the rest.

**Status: early development.** The site is live at <https://platform-toolkit.github.io>, but the
tools are still shells — no data is published yet and no calculation is wired up.

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
packages/data-access/     The port to wherever data lives, and today's static adapter
packages/ingestion/       Source adapters and anomaly checks. CI only.
packages/configuration/   Theme rules, and the protocol an embedding page speaks to a frame
packages/ui/              Shared elements, design tokens, theme wiring. The only DOM package.
data/                     Reviewed rule files, fixtures, change-detection state
docs/                     ADRs, source notes, embedding and operations guides
```

Data arrives from outside the program, so it is validated on read with a runtime schema, not
assumed. A source that changes shape produces a visible status, never a silently coerced number.

### Reading data

Nothing reads a URL directly. Every read goes through one interface in `packages/data-access`, whose
methods ask for what the application needs — the freshness of the published data, the records for a
cohort — rather than for a file. Artifact paths and any eventual shard arithmetic live in the static
adapter behind it, and one file, `apps/web/src/data-source.ts`, decides which adapter is in use.

Static hosting has a ceiling: the dataset is large, a Pages site is capped at 1 GB, and athlete
lookup is a query. A database behind an API is a plausible future, so the seam exists now, while
there is one implementation and nothing has been written against it. `PTK_DATA_ORIGIN` moves the
data to a separate https origin and widens `connect-src` by exactly that origin — the one directive
that would otherwise break such a move as a browser policy violation rather than a reportable error.
[ADR 0001](docs/adr/0001-data-access-seam.md) records the reasoning and what a migration would
touch.

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
the package is named in `pnpm-workspace.yaml`, and the list here is empty, so installing this
project executes no third-party code — on a contributor's machine or in the workflow that publishes
the site. A package that is not declared as a dependency also cannot be imported, which is what
keeps the boundary between the pure packages and the one DOM package real rather than conventional.
Unmet peer dependencies are configured to fail the install rather than warn.

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
defaults are set through documented query parameters — see [Theming](#theming). Inbound
`postMessage` payloads are accepted only from the framing window and are schema-validated, and no
arbitrary URL, CSS, HTML, or script is ever accepted from a parent. The only message sent outward is
the content height, which is a layout measurement and contains nothing else — imported athlete
information is never transmitted to a parent. That message names both the collection and the tool,
so a page embedding two tools can tell them apart rather than sizing both frames to whichever spoke
last.

Both directions of that protocol are declared together in `packages/configuration/src/embedding.ts`,
so the whole framing surface can be read in one file rather than inferred from the absence of code
elsewhere.

The federation is a path segment rather than a query parameter, so each federation's rules get their
own cacheable URL and an embedding site cannot silently switch which rules a reader is looking at.

## Theming

**Every tool follows the visitor's system setting, and no tool offers a theme toggle.** The visitor
has already made that choice, in their operating system. Asking again would mean asking them to keep
it right on every site that embeds one of these tools, and to be wrong on the ones they forget.

**The embedding site can override it**, because it is the only party that knows its own design. A
widget framed inside a dark page and rendering light is a visible defect, so add `theme` to the URL:

```html
<!-- Follows the visitor's system setting. This is the default; the parameter can be omitted. -->
<iframe
  src="https://example.invalid/platform-targets/embed/uspa/"
  title="Platform Targets"
></iframe>

<!-- Forces light, for a page that is light regardless of the visitor's setting. -->
<iframe
  src="https://example.invalid/platform-targets/embed/uspa/?theme=light"
  title="Platform Targets"
></iframe>

<!-- Forces dark. -->
<iframe
  src="https://example.invalid/platform-targets/embed/uspa/?theme=dark"
  title="Platform Targets"
></iframe>
```

Accepted values are `system`, `light`, and `dark`. Anything else falls back to `system` rather than
reaching the page.

If your page has its own light/dark switch, the frame can follow it without being reloaded — a
reload would discard whatever the visitor had entered. Post to the frame:

```js
frame.contentWindow.postMessage(
  { source: 'platform-toolkit', version: 1, type: 'set-theme', mode: 'dark' },
  'https://example.invalid',
);
```

Only the page that framed the document may send this, only these four fields are read, and only
those three modes are accepted. No CSS, markup, URL, or script is ever accepted from a parent.

There is no theme flash. `system` is handled entirely by `prefers-color-scheme` in CSS, so the
default case involves no JavaScript at all; a forced theme is applied by a small external script
before first paint, external so that a strict `script-src 'self'` policy still covers it.

Internally the configured _mode_ and the theme actually _in effect_ stay distinct. `system` is a
real mode, not a synonym for whichever theme it currently resolves to — code that conflates them
stops following the system the moment the system changes.

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
present the scan reports "skipped" and passes, which is the expected result for most people, and for
pull requests from forks — GitHub does not expose secrets to those.

The workflow that publishes the site runs `pnpm scan:references:strict`, which fails rather than
skips when no list is configured. Skipping there would mean nothing checked what is about to go live
and nobody was told, so the deploy is the one place the check refuses to be absent.

A maintainer whose machine has a work email configured globally can add an untracked
`.commit-identity.local` holding one exact address; the pre-commit hook then requires that address
and a signed commit **on that machine only**. Both files are gitignored and absent from a clone, so
a fresh checkout enforces nothing.

## License

[MIT](LICENSE)
