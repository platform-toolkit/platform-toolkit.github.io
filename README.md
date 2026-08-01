# Platform Targets

Powerlifting classification, record, and meet-qualification targets on one screen.

A lifter deciding what to attempt, and a meet director checking whether a registration is valid, are
both doing the same job today: opening half a dozen pages and correlating them by hand. Sex,
drug-tested status, equipment category, weight class, age division, state and national and world
records, classification standards, qualification windows, and prior results all live apart. This
puts them together, and shows the distance to the next thing worth chasing.

**Status: early development.** Nothing is deployed yet.

## What it does

Two ways in, one model out:

- **Choose manually** — sex, equipment, weight class, age division, tested status.
- **Import a public OpenPowerlifting profile** — the same fields, filled in from real results.

Import assists; it never takes over. Every imported value stays editable, and the manual path works
on its own.

From there the app shows current classification, the exact gap to the next one, applicable records
at state, national, and IPL World level, and whether a chosen meet's published criteria are met —
per discipline, and per equipment category.

## Architecture

Static site, no backend. GitHub Actions fetches every source on a schedule, validates and normalizes
it, and publishes plain JSON to GitHub Pages. The browser reads that JSON and runs every calculation
locally.

That is a deliberate trade. No server means no database to operate, no API to version, no
credentials to hold, and no request path that can be pointed at an attacker-chosen URL. Every source
is public, so the safest secret is the one that does not exist.

```
apps/web/                 Vite MPA: standalone screen + embeddable route
packages/domain/          Pure calculation. No DOM, no network, no I/O.
packages/data-contracts/  Runtime schemas and types for every published artifact
packages/ingestion/       Source adapters and anomaly checks. CI only.
packages/configuration/   Defaults, theme configuration, precedence resolution
data/                     Reviewed rule files, fixtures, change-detection state
docs/                     ADRs, source notes, embedding and operations guides
```

Data arrives from outside the program, so it is validated on read with a runtime schema, not
assumed. A source that changes shape produces a visible status, never a silently coerced number.

## Requirements

Node 24 (`.nvmrc` pins it; `nvm use` picks it up).

## Getting started

```sh
npm install     # also points git at .githooks
npm run dev     # standalone app
npm run verify  # format, lint, typecheck, test, reference scan, build
```

| Script                    | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `npm run dev`             | Vite dev server                               |
| `npm run build`           | Production build of every workspace           |
| `npm run typecheck`       | Packages, tests, and build config             |
| `npm run lint`            | ESLint, type-aware                            |
| `npm run format`          | Prettier, write                               |
| `npm test`                | Vitest, one project per package               |
| `npm run scan:references` | Commit-identity and forbidden-reference check |

## Embedding

The app is meant to be embedded. Any site may frame it, and nothing needs to be configured to allow
that.

```html
<iframe src="https://example.invalid/embed/uspa/?theme=dark" title="Platform Targets"></iframe>
```

Framing grants the parent page no access to application data and no control over it. Theme and
defaults are set through documented query parameters. Inbound `postMessage` payloads are
origin-checked and schema-validated, and no arbitrary URL, CSS, HTML, or script is ever accepted
from a parent. The only message sent outward is the content height, which is a layout measurement
and contains nothing else — imported athlete information is never transmitted to a parent.

## Theming

Three modes: `system`, `light`, `dark`. The configured mode and the resulting theme are kept
distinct throughout — `system` is a real choice, not a synonym for whichever theme it resolves to.

Precedence, highest first: host lock, then stored user preference, then host default, then `system`.
A host that locks the theme cannot have that lock overridden by a stored preference or by a message.

There is no theme flash. `system` is handled entirely by `prefers-color-scheme` in CSS, so the
common case involves no JavaScript at all; a forced theme is applied by a small external script
before first paint, external so that a strict `script-src 'self'` policy still covers it.

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

Run `npm run verify` before opening a pull request. Commit under your own name and email — the
project imposes no identity requirement on contributors.

`npm run scan:references` checks tracked content, file paths, and commit metadata against a list of
strings that must not appear in this repository. That list is deliberately **not** committed, in
plaintext or as digests: the tokens are short enough that a wordlist recovers them from hashes in
seconds, so a committed digest list is a committed list. Supply it locally through an untracked
`.prohibited-tokens.local` file or a `PT_PROHIBITED_TOKENS` environment variable. With neither
present the scan reports "skipped" and passes, which is the expected result for most people.

A maintainer whose machine has a work email configured globally can add an untracked
`.commit-identity.local` holding one exact address; the pre-commit hook then requires that address
and a signed commit **on that machine only**. Both files are gitignored and absent from a clone, so
a fresh checkout enforces nothing.

## License

[MIT](LICENSE)
