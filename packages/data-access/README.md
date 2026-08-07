# @platform-toolkit/data-access

The port between the application and wherever data is stored, plus the static-file adapter in use
today.

`DataSource` is the whole vocabulary of things the application may ask for. Nothing else in the
repository reads a URL. Today every answer is a JSON file published beside the site; a database
behind an API is a plausible future, and the point of the interface is that the change should not
reach the code asking the questions.

## Using it

One adapter is constructed at the composition root and passed down. Components take a `DataSource`,
never a base URL.

```js
import { DataSourceError, createStaticDataSource } from '@platform-toolkit/data-access';

const source = createStaticDataSource({ baseUrl: '/data/' });

try {
  const meta = await source.getDataMeta();
  console.log(meta.generatedAt, meta.sources.length);
} catch (error) {
  if (error instanceof DataSourceError) {
    console.warn(error.resource, error.reason, error.status);
  }
}
```

`baseUrl` is either a site-root-relative path or an absolute `https://` origin, and a trailing slash
is added if you leave it off. `fetch` is injectable for tests and defaults to the platform's.

Every method takes an optional `{ signal }`. Pass one. A reader changes their answer faster than a
network responds, and an un-aborted read either wedges a page or lands an answer to a question
nobody is asking any more.

## The three things to get right

**`null` is an answer, not a failure.** `getRecords`, `getClassifications`, `getCategoryCatalog`,
`getConversionChart`, `getMeetRuleProfiles`, `getQualifyingMeets` and `getAthleteMirror` all resolve
to `null` when this build published nothing for that query. That is a normal state and the screen
should say so. A real failure throws.

**A failure is always a `DataSourceError`,** with `resource`, `reason` and, for HTTP, `status`. The
reasons are coarse on purpose — `network`, `http`, `malformed`, `aborted` — because a caller only
needs to tell "try again" from "this will never work" from "the published data is wrong".

```
DataSourceError: Could not read "dataMeta": http 404
```

It carries no URL and no fragment of the response body, and it has nowhere to put them. Error text
reaches logs, and a URL is exactly where a lifter's identity would end up once name lookups exist.

**Ask for intent, never mechanism.** `RecordSetQuery` and `ClassificationSetQuery` name the axes a
reader holds fixed for a session — federation, level, region, sex, equipment. Sharding, artifact
filenames and the index are the static adapter's private business. A caller that knows the shard
count is a caller that has to change when the storage does.

`findAthletes(name)` returns `{ outcome: 'unusable' }` or `{ outcome: 'found', matches }`, because
"nobody is called that" and "that is not a name we can look up" are different sentences. The static
adapter folds the name to a key in the browser and requests a numbered shard, so the name itself
never leaves the tab. Any replacement adapter has to hold that line.

Everything the source returns has already been validated against its schema from
`@platform-toolkit/data-contracts`. A response that does not match is a `malformed` failure, never a
silently coerced number.

## Licence

Apache-2.0. See the repository `LICENSE`.
