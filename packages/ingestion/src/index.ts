/**
 * Ingestion entry point.
 *
 * Everything in this package runs in CI and never reaches the browser. External
 * fetching lives here and only here, which is what keeps the published
 * application free of any code path that requests a user-supplied URL.
 *
 * Categories and classifications are adapted here today; the OpenPowerlifting
 * mirror, qualification rules, and records follow. Each adapter produces a value;
 * turning values into published files is `publication.ts`, and only
 * `publication.ts`.
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
export {
  CategorySourceDocumentSchema,
  CategorySourceError,
  buildCategoryCatalog,
  type CategorySourceDocument,
  type CategorySourceResult,
} from './sources/category-catalog.js';
export {
  ClassificationSourceDocumentSchema,
  ClassificationSourceError,
  buildClassificationTables,
  readClassificationSourceReferences,
  type ClassificationSnapshot,
  type ClassificationSourceDocument,
  type ClassificationSourceReferences,
  type ClassificationSourceResult,
  type WithheldRow,
} from './sources/classification-standards.js';
export {
  ClassificationShardNamingError,
  DuplicateClassificationTableError,
  shardClassificationBook,
  type ClassificationShardArtifact,
} from './shard-classifications.js';
export {
  DuplicateRecordError,
  ShardNamingError,
  shardRecordBook,
  type RecordShardArtifact,
} from './shard-records.js';
export { writePublication, type WriteSummary } from './write-publication.js';
