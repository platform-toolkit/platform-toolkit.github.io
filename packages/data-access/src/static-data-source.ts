/**
 * The strategy in use today: every answer is a JSON file that CI published
 * alongside the site.
 *
 * Everything that is true only of static hosting lives in this file. Artifact
 * paths, the eventual shard arithmetic, and any client-side narrowing that an
 * API would do in a query belong here and nowhere above it. That containment is
 * the whole point -- an HTTP adapter added later implements the same interface,
 * and no calling code learns which one it got.
 */
import { DataMetaSchema, type DataMeta } from '@platform-toolkit/data-contracts';

import type { DataSource, DataSourceKind, ReadOptions } from './data-source.js';
import { fetchJson, type FetchLike } from './fetch-json.js';

/**
 * Every artifact this adapter is allowed to read.
 *
 * A closed table, not a parameter. The project's rule is that no
 * caller-controlled URL is ever fetched, and the way to guarantee it rather than
 * remember it is to leave no argument through which a path could be supplied.
 * Adding a resource is an edit here, reviewable as such.
 */
const RESOURCE_PATHS = {
  dataMeta: 'meta.json',
} as const satisfies Record<string, string>;

export interface StaticDataSourceOptions {
  /**
   * Where the published artifacts live: either a site-root-relative path such as
   * `/data/` or an absolute `https://` URL if they are ever moved to their own
   * origin.
   */
  readonly baseUrl: string;
  /** Injectable for tests. Defaults to the platform's. */
  readonly fetch?: FetchLike;
}

export function createStaticDataSource(options: StaticDataSourceOptions): DataSource {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    kind: 'static' satisfies DataSourceKind,

    getDataMeta(readOptions?: ReadOptions): Promise<DataMeta> {
      return fetchJson({
        resource: 'dataMeta',
        url: baseUrl + RESOURCE_PATHS.dataMeta,
        schema: DataMetaSchema,
        fetch: fetchImpl,
        ...(readOptions?.signal ? { signal: readOptions.signal } : {}),
      });
    },
  };
}

/**
 * Accepts a root-relative path or an `https://` origin, rejects everything else,
 * and guarantees a trailing slash so that path joining is plain concatenation.
 *
 * The scheme check is not ceremony. This value comes from build configuration
 * today, but build configuration is exactly the kind of thing that later gets
 * wired to a runtime setting; refusing `http:` and protocol-relative forms at
 * the one place they enter means that change cannot quietly downgrade the
 * transport. `..` is refused because a base is a prefix, not a traversal.
 */
function normalizeBaseUrl(baseUrl: string): string {
  if (baseUrl.includes('..')) {
    throw new TypeError('Data base URL must not contain a path traversal segment.');
  }

  const withSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  if (withSlash.startsWith('//')) {
    // Protocol-relative: inherits the page's scheme, so it is `http:` on an
    // `http:` page. Never what is wanted, and easy to write by accident.
    throw new TypeError('Data base URL must not be protocol-relative.');
  }
  if (withSlash.startsWith('/')) {
    return withSlash;
  }

  let parsed: URL;
  try {
    parsed = new URL(withSlash);
  } catch {
    throw new TypeError('Data base URL must be a root-relative path or an absolute https URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new TypeError('Data base URL must use https.');
  }
  return parsed.href;
}
