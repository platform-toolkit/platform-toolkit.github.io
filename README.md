# Platform Toolkit

Open-source tools for powerlifters and meet directors. Each one works on its own, and any site may
embed a single tool without taking the rest.

**Status: early development.** The site is live at <https://platform-toolkit.github.io>. Four tools
ship today. Platform Targets is usable end to end for classification standards: pick a category,
enter what you have lifted, and it tells you where that places and how far the next class is.
Records, meet qualification, and profile import are not built yet.

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

From there it shows current classification and the exact gap to the next one, per lift and for the
total. A total left blank is added up from the three lifts, and the field says so — a typed total
always wins, because a lifter entering one directly is asserting it came from a different day.

Still to come: applicable records at state, national, and IPL World level, and whether a chosen
meet's published criteria are met — per discipline, and per equipment category.

### Warm-Up Calculator

A warm-up ramp for a working weight, on the plates that are actually in front of you.

Tell it what is on the rack — the bar, the plates you have, whether collars go on — and it builds a
ramp that is loadable at every step rather than a percentage table you then round by hand. Each set
shows the loading, plate by plate and per side, and you tick sets off as you take them.

A working weight the bar cannot be loaded to is shown as exactly that, with the nearest weight below
and the nearest above. It is never silently moved to one of them.

The ticked-off sets deliberately do not outlive the session. A rack and a set of plates are settings
and are remembered; a half-finished ramp reopened next week would be presenting scratch state as a
training record.

### Pounds and Kilograms

Two numbers that are routinely confused, kept apart.

The **exact** conversion is arithmetic: `1 lb = 0.45359237 kg`, with no intermediate rounding. The
**chart** figure is the weight a federation's own published conversion chart lists, and that is the
one that governs an attempt. They are labelled separately and the chart figure leads, because a
lifter who submits the exact figure has submitted a weight the table does not contain.

No chart row is ever generated. A weight between two published rows produces the rows either side
and says which is nearer — measured in the column the weight was stated in, since the published
pound figures are the federation's own and not conversions of the kilogram column. An exact midpoint
is shown as equally close to both and resolves nothing.

Barbell milestones are listed in the unit being converted **to** — converting pounds to kilograms
lists the kilogram loadings, because that is the platform you are headed for — with the reading in
the other unit beside each. Their loading assumptions are stated: the pound sequence excludes
collars, the kilogram sequence includes 5 kg of competition collars.

### One-Rep Max Estimator

What a set you have already done suggests about a single, from the published equations — including
where they disagree.

Enter a weight and a repetition count and it answers with a conservative figure, a middle figure and
an optimistic one, rounded to a step a bar can actually be loaded to. Underneath, every published
equation in the library is listed with its notation, its citation, what it answered for this set,
and the reason it did or did not contribute. Equations that are the same relationship under two
names get one vote between them, not two.

Optional questions — movement standard, repetitions left in reserve, freshness, form, training
experience, reported sex — change the **grade** of the estimate rather than the figure. Answering
all of them does not produce a bigger number, and the tool opens on the answer that claims nothing
rather than on the one that flatters the estimate. Reported sex is the one that also touches the
arithmetic, and only for the bench press and the squat: two of the studies behind the weighting
reported men and women separately, so answering it lets those equations count for more. Declining it
is a supported answer that still produces an estimate with every eligible equation counting equally.

None of the equations uses body weight, which is why the tool never asks for it. The notation is `w`
for the weight on the bar throughout, and there is a legend saying so above the equations — the
published equations that _do_ take a body weight predict a maximum from repetitions at one fixed
test load rather than from a set at a weight you chose, so they answer a different question.

The spread between equations is shown as what it is: disagreement between published models. It is
not a confidence interval, not a margin of error, and says nothing about how likely any figure is.
No attempt is labelled safe, and nothing here is an opener.

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
pnpm verify           # format, typecheck, lint, test, reference scan, build, and the checks
                      # that need a build: narrow layout, installability, stories
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
| `pnpm check:narrow`    | The built site at phone widths                |
| `pnpm check:pwa`       | Manifest, icons, and offline rendering        |
| `pnpm storybook:check` | Builds every story and loads it in a browser  |

The last three run against `dist`, so they need `pnpm build` first.

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
Tools whose answers do not depend on a federation have no such segment:

| Tool                  | Embed route                     |
| --------------------- | ------------------------------- |
| Platform Targets      | `/platform-targets/embed/uspa/` |
| Warm-Up Calculator    | `/warm-up/embed/`               |
| Pounds and Kilograms  | `/convert/embed/uspa/`          |
| One-Rep Max Estimator | `/one-rep-max/embed/`           |

An embed route is chrome-free: no site header, no navigation, and no link out of the frame. It also
installs nothing on your visitors — no service worker is registered and no web app manifest is
linked from a framed document, so embedding a tool never caches anything under your origin.

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

## Installing and offline use

The site is an installable progressive web app. Open it in a browser that supports installation and
you can add it to a home screen or launcher; opened from there it runs without browser chrome, and
it works with no network.

That is not a novelty. These tools are used in a gym: a lifter checking a weight class at a warm-up
rack, a meet director working a registration list on the platform floor. Both are places where a
phone shows one bar of signal and a page load takes fifteen seconds, and both are places where the
answer is needed between sets.

**One application, not one per tool.** Installing from any page in the collection installs the same
thing, and it opens at the tool index. The collection is the app; the tools are screens within it.

What is available offline:

| Content                       | How it is cached                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Pages, scripts, styles, icons | Precached at install. Available on first launch, before any page has been visited.        |
| Published federation data     | Cached the first time a page reads it. A tool you have opened once keeps working offline. |

Federation data is deliberately not precached. Each published artifact is budgeted at 2 MiB, and
downloading every federation's record book the moment somebody installs the site is exactly the
thing a metered connection notices.

Updates arrive on the next visit with a connection. Pages and the data index are fetched from the
network first and fall back to the cache, so a working connection always shows current content; new
application code takes effect once every tab of the old version has been closed. Waiting for that is
intentional — a new worker that took over immediately would leave an open page asking for files its
cache no longer holds.

**Embedded frames install nothing.** The embed routes carry no manifest and register no service
worker, so embedding a tool never puts anything on the embedding site's visitor, and never caches
anything under the embedding page's origin. Installation is offered on the tool index and the
standalone tool pages only.

Installability is verified against the real build by `pnpm check:pwa`, which serves the output,
waits for a service worker to take control, clears the browser's own HTTP cache, switches the
network off, and requires the pages to still render. It also reads each icon's PNG header to check
the file is the size the manifest claims, and asserts the embed route registered nothing.

## Privacy

Imported athlete data and profile URLs are not persisted by default. Athlete names and full profile
URLs are kept out of logs, and athlete identity is never included in error reports.

## Data sources

All public. Source, retrieval time, and revision are recorded for every artifact and surfaced in the
app, per tier — a state record and a national record can differ in age, and showing one timestamp
for both would misrepresent the newer one.

Competition results come from the OpenPowerlifting bulk dataset, which carries a public-domain
waiver. Only its published data is consumed; none of its application code is used.

### Keeping them current

Some datasets are downloaded whole and committed under `data/sources/`, alongside a hand-written
mapping that says what each column means. Those two have to agree: a federation can add a weight
class or renumber a grade without breaking anything that parses, and the result would be published
figures nobody re-read. So each snapshot is pinned by sha-256 in its mapping, and the build fails
when the file and the pin disagree.

That lock only turns when somebody builds. `pnpm data:upstream` is the doorbell — it downloads what
each source publishes today, digests it, and writes `data/upstream-check.json`. It changes nothing:
a source that has moved is reported, because adopting it means reading the new data against the
mapping, which is exactly the deliberate step the pin exists to force.

A weekly workflow runs it, commits the report, and opens an issue when something has drifted. The
report's timestamp moves on every run, so a green week still records that the repository looked and
found nothing changed. A source with no recorded download URL is reported as `manual` rather than
omitted — "nobody is watching this" and "this has not changed" are different facts, and a report
that renders them identically is worse than no report.

Records are the exception, and refresh themselves. They change after every meet, so a digest that
had to be re-cut weekly would stop being a decision anybody made; instead the mapping beside the
corpus describes the federation's _vocabulary_ rather than its rows, and the build refuses when the
two stop agreeing. A second weekly workflow crawls the record tables, runs the whole corpus through
those checks and a dry run of the publisher before it is allowed near the repository, commits only
when the figures actually moved, and then redeploys the site. A meet weekend passes the checks; a
site redesign does not, and the run fails having committed nothing. The retrieval date the app shows
for records moves with the data rather than with the crawl, so it can be older than the last check
but never newer than the figures.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the whole process; [GOVERNANCE.md](GOVERNANCE.md) says who
decides and how. The short version: run `pnpm verify` before opening a pull request, sign your
commits off with `git commit -s` to certify the [DCO](DCO.md), and commit under your own name and
email — the project imposes no identity requirement on contributors, and there is no CLA and no
copyright assignment. Security problems go to [SECURITY.md](SECURITY.md), not to a public issue.

One local check is worth explaining here because it is unusual and it will confuse you otherwise.
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

[Apache License 2.0](LICENSE), with attribution requirements set out in [NOTICE](NOTICE).

Use it, embed it, fork it, ship it in something you sell. The licence asks for attribution, for the
NOTICE file to travel with redistributions, and for changed files to be marked. It grants a patent
licence along with the copyright one, which is the practical reason to prefer it over a shorter
permissive licence: an organisation embedding a widget does not have to work out the patent position
for itself.

Third-party code distributed with the toolkit is attributed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); every installed dependency and its licence is
inventoried in [docs/dependency-licenses.md](docs/dependency-licenses.md), and that inventory is
enforced by `pnpm run check:licenses` rather than maintained by hand.

Releases up to the `mit-final` tag were published under the MIT License and remain available under
it. Nothing about your permissions has narrowed.

The licence covers the software. It does not license anyone else's data or trademarks — federation
records and standards here are independently encoded public facts, and federation names belong to
their owners. See [NOTICE](NOTICE).
