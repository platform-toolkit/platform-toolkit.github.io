/**
 * Ingestion entry point.
 *
 * Everything in this package runs in CI and never reaches the browser. External
 * fetching lives here and only here, which is what keeps the published
 * application free of any code path that requests a user-supplied URL.
 *
 * Source adapters land in P1 (classifications), P2 (OpenPowerlifting mirror),
 * P3 (qualification rules), and P4 (records). Each one produces a value; turning
 * values into published files is `publication.ts`, and only `publication.ts`.
 */

export { NonSerializableValueError, canonicalJson } from './canonical-json.js';
export {
  SOURCE_FETCH_TIMEOUT_MS,
  ALLOWED_SOURCE_HOSTS,
  assertAllowedSourceUrl,
} from './fetch-policy.js';
export {
  ARTIFACT_BUDGET_BYTES,
  ArtifactTooLargeError,
  ArtifactValidationError,
  DATA_META_PATH,
  planPublication,
  type ArtifactSource,
  type PublicationPlan,
  type PublicationRequest,
  type PublishedFile,
} from './publication.js';
export { writePublication, type WriteSummary } from './write-publication.js';
