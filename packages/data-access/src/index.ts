// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

export {
  DataSourceError,
  type AthleteLookup,
  type ClassificationSetQuery,
  type DataSource,
  type DataSourceFailureReason,
  type DataSourceKind,
  type ReadOptions,
  type RecordSetQuery,
} from './data-source.js';
export { type FetchLike } from './fetch-json.js';
export { createStaticDataSource, type StaticDataSourceOptions } from './static-data-source.js';
