// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Ingestion entry point.
 *
 * Everything in this package runs in CI and never reaches the browser. External
 * fetching lives here and only here, which is what keeps the published
 * application free of any code path that requests a user-supplied URL.
 *
 * Categories, classifications, records, conversions, meet rules and the results
 * archive are adapted here today; qualification rules follow. Each adapter
 * produces a value; turning values into published files is `publication.ts`, and
 * only `publication.ts`.
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
  AthleteCorpusError,
  AthleteMirrorDocumentSchema,
  buildAthleteMirror,
  projectCorpusRow,
  readCorpusColumns,
  summarizeWithheld,
  type AthleteMirror,
  type AthleteMirrorDocument,
  type AthleteMirrorResult,
  type CorpusColumns,
  type WithheldEntryRow,
} from './sources/athlete-mirror.js';
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
  RecordSourceDocumentSchema,
  RecordSourceError,
  buildRecordBook,
  readRecordSourceReferences,
  type RecordSourceDocument,
  type RecordSourceReferences,
  type RecordSourceResult,
  type WithheldRecordRow,
} from './sources/records.js';
export {
  ConversionSourceDocumentSchema,
  ConversionSourceError,
  buildConversionChart,
  readConversionSourceReferences,
  type ConversionAnomaly,
  type ConversionSourceDocument,
  type ConversionSourceResult,
} from './sources/conversion-chart.js';
export {
  MeetRulesSourceDocumentSchema,
  MeetRulesSourceError,
  buildMeetRuleBook,
  readMeetRulesSourceReferences,
  type MeetRulesSourceDocument,
  type MeetRulesSourceResult,
} from './sources/meet-rules.js';
export {
  DuplicateAthleteError,
  UnreachableAthleteError,
  shardAthleteMirror,
  type AthleteShardArtifact,
} from './shard-athletes.js';
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
export { RetrievalStampError, stampRetrievedAt } from './stamp-retrieval.js';
export {
  checkUpstream,
  type UpstreamFinding,
  type UpstreamReport,
  type UpstreamSource,
  type UpstreamStatus,
} from './upstream-check.js';
export { writePublication, type WriteSummary } from './write-publication.js';
