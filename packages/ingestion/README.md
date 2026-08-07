# @platform-toolkit/ingestion

Source adapters, normalizers, and anomaly checks. Runs in CI, never in the browser.

Every artifact the site reads is produced here: categories, classification standards, records,
conversion charts, meet rules, qualification criteria and the results archive. An adapter turns a
reviewed source document into a value; `planPublication` turns values into files. Nothing else
writes published data.

**External fetching lives here and only here.** That is what lets the deployed application contain
no code path that requests a URL somebody supplied, which is the property the whole split exists to
protect. Do not import this package from anything that ships to a browser.

## Running it

From the repository root, after `pnpm run build:libraries`:

| Script                        | What it does                                               |
| ----------------------------- | ---------------------------------------------------------- |
| `pnpm run data:emit`          | Builds and writes the published data set                   |
| `pnpm run data:check`         | The same, `--dry-run`: plans and validates, writes nothing |
| `pnpm run data:upstream`      | Reports whether any source has changed since it was read   |
| `pnpm run data:crawl:records` | Fetches record tables from allowlisted hosts               |
| `pnpm run data:stamp`         | Stamps a source document with its retrieval time           |

## Planning a publication

`planPublication` is pure: it takes values and returns files, and touches neither the clock nor the
disk. `writePublication` is the only part that writes.

```js
import { planPublication } from '@platform-toolkit/ingestion';
import { ConversionChartSchema } from '@platform-toolkit/data-contracts';

function planConversions(chart) {
  return planPublication({
    generatedAt: '2026-01-15T00:00:00.000Z',
    sources: [
      {
        id: 'conversions',
        label: 'Conversion chart',
        retrievedAt: '2026-01-14T00:00:00.000Z',
        status: 'ok',
      },
    ],
    artifacts: [
      {
        id: 'conversions-demo',
        schema: ConversionChartSchema,
        schemaVersion: 1,
        value: chart,
      },
    ],
  });
}

planConversions(chart).files.map((file) => file.path);
// ['artifacts/conversions-demo.<content hash>.json', 'meta.json']
```

`generatedAt` is an argument rather than a clock read, so a build is reproducible.

Artifact filenames are content-addressed, so a file that did not change keeps its name and a file
that did gets a new one. `meta.json` (`DATA_META_PATH`) maps artifact ids to those names and is
**last in `plan.files` on purpose** — upload in order, and a reader either sees the whole previous
build or the whole new one, never an index pointing at a file that is not there yet.

Two failures come out of planning rather than out of production:

- `ArtifactValidationError` — the value does not satisfy its own schema. `problems` names the
  fields, e.g. `['rows: expected >=2']`.
- `ArtifactTooLargeError` — the serialized artifact exceeds `ARTIFACT_BUDGET_BYTES` (2 MiB), or the
  `maxArtifactBytes` you passed. The budget is a phone on a gym network, not a disk limit; the fix
  is to shard, which is what `shardRecordBook`, `shardClassificationBook` and `shardAthleteMirror`
  are for.

Serialization is `canonicalJson`, which is what makes the content hash stable across runs. It throws
`NonSerializableValueError` rather than quietly dropping a value JSON cannot represent.

## Fetching

```js
import { SOURCE_FETCH_TIMEOUT_MS, assertAllowedSourceUrl } from '@platform-toolkit/ingestion';

assertAllowedSourceUrl('https://example.invalid/records');
// throws: Host is not on the source allowlist: example.invalid
```

The allowlist is an exact host match, not a suffix match, so a lookalike subdomain of an allowed
host is refused. `https` only, and a URL carrying embedded credentials is refused whatever its host.
Reads time out at `SOURCE_FETCH_TIMEOUT_MS` (60 seconds).

Every adapter validates its source document against a schema before it normalizes anything, and
reports what it withheld rather than dropping it silently — `summarizeWithheld`, `WithheldRow`,
`ConversionAnomaly`. A row that could not be understood is a visible finding, never a coerced
number.

## Licence

Apache-2.0. See the repository `LICENSE`.
