# @platform-toolkit/data-contracts

Runtime schemas and types for every published static data artifact.

Data arrives from outside the program, so it is validated on read rather than assumed. Each artifact
has one schema here, and both ends use it: the ingestion step validates before it writes, and the
browser validates after it reads. A source that changes shape produces a visible status, never a
silently coerced number.

The other half of the package is the naming: the functions that turn a query into an artifact id.
They live here, and nowhere else, because the publisher and the reader have to agree on a filename
without either of them importing the other.

## Validating

Schemas are valibot schemas, exported alongside the type they infer.

```js
import * as v from 'valibot';
import { DataMetaSchema } from '@platform-toolkit/data-contracts';

const result = v.safeParse(DataMetaSchema, await response.json());
if (!result.success) {
  // the artifact is wrong; say so on screen
}
const meta = result.output; // DataMeta
```

Types are inferred from the schemas, so a type cannot drift from what is checked at runtime. Import
the type when you only need the shape and the schema when something crosses a trust boundary.

Most consumers never call `safeParse` themselves — `@platform-toolkit/data-access` validates every
read for them. Reach for the schemas directly when you are producing an artifact, or reading one
from somewhere the seam does not cover.

## Naming an artifact

```js
import { recordArtifactId } from '@platform-toolkit/data-contracts';

recordArtifactId('uspa', {
  levelId: 'national',
  regionId: null,
  sex: 'female',
  equipmentId: 'raw',
});
// 'records-uspa-national-female-raw'
```

`classificationArtifactId`, `categoryCatalogArtifactId`, `conversionChartArtifactId` and
`athleteArtifactId` do the same for the other partitions; `MEET_RULES_ARTIFACT_ID`,
`QUALIFYING_MEETS_ARTIFACT_ID` and `ATHLETE_MIRROR_ARTIFACT_ID` are the ids of the artifacts that
have no partitions. An id is not a path — the index in `meta.json` maps ids to the content-addressed
files that hold them.

## Looking a lifter up

The athlete archive is too large to publish as one file, so it is sharded by a fold of the name.

```js
import {
  ATHLETE_SHARD_COUNT,
  athleteLookupKey,
  athleteShardBucket,
} from '@platform-toolkit/data-contracts';

const key = athleteLookupKey('Jane Doe'); // 'janedoe'
if (key !== null) {
  athleteShardBucket(key); // 159, of ATHLETE_SHARD_COUNT (512)
}
```

`athleteLookupKey` answers `null` for input that cannot be looked up at all — blank, punctuation, a
script the fold does not reduce to Latin letters. Handle it; there is no shard to ask.

The fold is idempotent: folding an already-folded key gives the same key back. That is what lets a
username and a spelled-out name land in the same shard, and it is a property to preserve, not an
accident.

The point of the fold is that a lookup asks for a numbered shard. The name never goes into a
request, which means it never reaches a log, and the shard is the same file for everyone whose name
folds into it.

`findAthleteHistories(shard, key)` narrows a fetched shard to the people under that key. It can
return more than one, and a caller must show all of them rather than pick. Two people under one
spelling is ordinary.

## Weights and sexes

`SexCategory` is a closed picklist rather than a string, because unlike a federation's own
identifiers it is a set the whole project agrees on and a typo in it should not compile. The same
goes for `Lift`, `Discipline` and `AgeBasis`.

Federation figures — weight classes, qualifying totals, classification standards — are artifact
content, never source. That is what makes a rule change a data refresh instead of a release.

## Licence

Apache-2.0. See the repository `LICENSE`.
