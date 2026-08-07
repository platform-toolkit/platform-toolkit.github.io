# @platform-toolkit/web

The deployed site: the tool index, and each tool's standalone and embeddable pages.

One Vite multi-page application. There is no router and no client-side navigation — every route is a
real HTML file with its own entry script, so a route loads only the code it needs and a broken tool
cannot take the rest of the site down. Nothing here is published to a registry; it is the shell that
composes the packages, and it consumes them exactly as a third party would.

## Running it

```sh
pnpm install
pnpm run build:libraries
pnpm run dev
```

`build:libraries` first, because the app resolves the workspace packages through their built
`dist/`. Inside this directory the scripts are `dev`, `build` and `preview`.

## Routes

| Route               | Standalone           | Embeddable                      |
| ------------------- | -------------------- | ------------------------------- |
| Conversion chart    | `/convert/`          | `/convert/embed/uspa/`          |
| One-rep max         | `/one-rep-max/`      | `/one-rep-max/embed/`           |
| Warm-up planner     | `/warm-up/`          | `/warm-up/embed/`               |
| Platform targets    | `/platform-targets/` | `/platform-targets/embed/uspa/` |
| Meet day            | `/meet-day/`         | `/meet-day/embed/`              |
| Training logbook    | `/logbook/`          | `/logbook/embed/`               |
| Qualification check | `/qualify/`          | `/qualify/embed/uspa/`          |

`/` is the index. An embed route whose path carries a trailing federation segment reads that
federation's published figures; the segment is a path rather than a query parameter so each
federation's view is its own document, cacheable and linkable on its own.

`theme` is the only query parameter any of these pages reads.

## How a page is wired

Each page's HTML carries `<main id="app" data-federation="…">` where the tool needs a federation,
and `parseFederationId` in `src/federation.ts` throws if it is absent or malformed rather than
falling back to one. A silent default would render another federation's numbers under this page's
name.

`src/data-source.ts` is the composition root:

```ts
export const dataSource: DataSource = createStaticDataSource({
  baseUrl: __PTK_DATA_BASE_URL__,
});
```

It is the only place a base URL exists. Views take the `DataSource`, never a URL, so moving the data
to another origin is a build variable and not a code change.

An embed page differs from its standalone twin in three ways, all deliberate: it links no web app
manifest, it registers no service worker, and it publishes its rendered height to the parent. It
carries `<body data-embedded="true">` and a favicon and nothing else.

## Build variables

| Variable          | Default | What it does                                                                      |
| ----------------- | ------- | --------------------------------------------------------------------------------- |
| `PTK_BASE_PATH`   | `/`     | Path the site is served under, for a deployment below the root of a domain.       |
| `PTK_DATA_ORIGIN` | unset   | Absolute `https://` origin the published data is read from. Widens `connect-src`. |

`PTK_DATA_ORIGIN` is rejected unless it is an absolute `https://` origin with no path, query or
fragment. Left unset, data is read from the same origin as the site and the content security policy
stays as narrow as it can be.

The policy is emitted from `vite.config.ts` and deliberately sets no `frame-ancestors`. Any site may
frame the embed routes; that is the feature.

Source maps are off in the production build.

## Offline

`service-worker.js` is written by hand, not generated. `vite.config.ts` substitutes the precache
list with the actual emitted filenames and emits the result as `sw.js` at the root of the build
output. The application shell is precached; published data is not, and is cached only once something
has asked for it — precaching every artifact would download the whole archive to look up one
conversion.

`sw.js` scopes to the whole deployment including the embed routes, which is harmless: an embedded
view never registers a worker, but it will load offline if a visit to the site proper already
installed one.

## Licence

Apache-2.0. See the repository `LICENSE`.
