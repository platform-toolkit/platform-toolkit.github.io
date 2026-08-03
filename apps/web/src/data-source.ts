// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The composition root for data access: the single place that decides which
 * implementation the application runs against.
 *
 * Page entries and components import `dataSource` and see only the interface.
 * Switching the whole site to an API is an edit to this file plus setting
 * `PTK_DATA_ORIGIN` -- deliberately, so that the decision is visible in one
 * place rather than distributed across every call site.
 */
import { createStaticDataSource, type DataSource } from '@platform-toolkit/data-access';

export const dataSource: DataSource = createStaticDataSource({
  baseUrl: __PTK_DATA_BASE_URL__,
});
