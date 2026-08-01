# 1. Put a port between the application and its data

**Status:** accepted — 2026-07-31

## Context

The site is static. GitHub Actions fetches every public source on a schedule, validates and
normalizes it, and publishes JSON to GitHub Pages; the browser reads that JSON and calculates
locally. That is the right shape for the problem today: no server, no database to operate, no
credentials to hold.

It may not stay the right shape. The OpenPowerlifting mirror is several hundred megabytes and a
Pages site is capped at 1 GB, so growth in either the dataset or the number of tools eventually
forces the question. Athlete lookup is also a query, and answering queries by shipping a sharded
index to the browser has a ceiling. A database behind an API is a plausible future.

Nothing reads data yet. This is the cheapest moment there will ever be to decide how it gets read,
because the decision costs a package and an afternoon now and a rewrite of every call site later.

The failure to avoid is not "we chose static hosting". It is the version of static hosting where
artifact paths, shard arithmetic, and `fetch` calls are spread through page entries and components,
so that changing where data lives means touching all of them and re-testing every screen.

## Decision

A `@platform-toolkit/data-access` package holds a `DataSource` interface — the port — plus the
static-file adapter that implements it today.

Four properties do the work:

**Methods express intent, not mechanism.** A caller asks for the freshness of the published data,
not for `/data/meta.json`. Shard counts, artifact names, and file layout are facts about one storage
strategy; a caller that knows them is a caller that has to change when the storage does.

**Every method is asynchronous**, including ones an implementation could answer immediately. A
synchronous read that later becomes a network call rewrites every call site and every component that
renders the result.

**Every method takes an `AbortSignal`.** Retrofitting cancellation is the same rewrite.

**Failures are one typed error with a closed set of reasons** — `network`, `http`, `malformed`,
`aborted`. Callers distinguish "retry" from "this will never work" from "the published data is
wrong", and get the same four regardless of which adapter produced them.

Filtering follows from the first property. The static adapter fetches an artifact and narrows it in
the browser; an API adapter pushes the same narrowing into a query. Callers say which slice they
want and stay out of the argument.

One composition root, `apps/web/src/data-source.ts`, constructs the implementation. It is the only
file that names a concrete adapter.

### Supporting changes

`connect-src 'self'` was the single directive that would have broken a migration silently — a
request to a new origin fails as a browser policy violation, not as an error the application can
report and not in any test that runs against the dev server. `PTK_DATA_ORIGIN` now widens both the
policy and the data base URL by exactly one validated https origin, defaulting to same-origin.

The transport is injected rather than taken from the global. Tests supply a fake and assert on
classification and URL construction without a network or a patched global.

## Consequences

A move to an API touches:

1. A new adapter in `packages/data-access` implementing the same interface.
2. One line in `apps/web/src/data-source.ts`.
3. `PTK_DATA_ORIGIN` in the deploy workflow.
4. Authentication, if the API has any — which is a genuinely new concern, not a migration cost. It
   would need somewhere to live that is not the browser, and this decision does not pretend to
   answer it.

It does not touch page entries, components, or the calculation packages.

The cost is a layer of indirection over what is currently one `fetch`, and the ongoing discipline of
adding a method to the interface rather than reaching around it. The compiler enforces the second
part: a capability added to one adapter and not the other does not compile.

### Rejected alternatives

**Call `fetch` where the data is needed and refactor later.** The refactor is the expensive part,
and it lands at the moment there is the least appetite for it — mid-migration, with every screen to
re-test.

**A generic client with `get(path)`.** It would still be a seam, but the wrong one: paths are
mechanism, so every caller would keep a static-hosting assumption and an API adapter would have to
reverse-engineer intent from URLs. It also puts a caller-supplied path into a fetch, which the
project's rules forbid. The current adapter has a closed table of resources and no argument through
which a path could arrive.

**Wait until the data model exists.** The interface has one method today because one artifact is
published today. Establishing the seam does not require knowing the eventual shape; it requires that
the first read go through it rather than around it.

## Notes

The package ships to the browser and must not touch the DOM. It gets `@types/node` for the WHATWG
networking globals — `fetch`, `Response`, `AbortSignal`, `URL` — because pulling in the `DOM` lib to
obtain them would also hand it `document` and `window`, making the "only `packages/ui` touches the
DOM" rule a convention rather than something the compiler enforces. ESLint separately refuses
`node:` imports there, so the types cannot become a doorway to Node APIs that a browser does not
have.
