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
import {
  DataMetaSchema,
  RecordBookSchema,
  type ArtifactReference,
  type DataMeta,
  type RecordBook,
} from '@platform-toolkit/data-contracts';

import type { DataSource, DataSourceKind, ReadOptions } from './data-source.js';
import { fetchJson, type FetchLike } from './fetch-json.js';

/**
 * The one path this adapter knows by name.
 *
 * Every other artifact is reached through the index that this file contains,
 * and the index carries a content hash in each path so an artifact can be
 * cached permanently. The project's rule is that no caller-controlled URL is
 * ever fetched; what enforces it here is that a caller supplies an identifier,
 * the identifier is looked up in a same-origin document that CI wrote, and the
 * path that comes back was validated as a relative path when the index was
 * parsed. An identifier that is not in the index resolves to nothing at all.
 */
const DATA_META_PATH = 'meta.json';

/** Prefix that turns a book identifier into its artifact identifier. */
const RECORD_BOOK_ARTIFACT_PREFIX = 'records-';

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

  /**
   * The index, once it has been read successfully.
   *
   * Held for the lifetime of the source, and not only to save a request. Every
   * artifact path is resolved through this object, so caching it is what makes
   * a screen show one build: without it, two reads either side of a deploy
   * would mix an old record book with a new classification table, and nothing
   * would look wrong. A page that wants newer data reloads.
   *
   * Only successful reads are cached, and concurrent first reads may each fetch
   * it. Sharing one in-flight promise would be tidier but would make one
   * caller's cancellation everyone else's failure, which is a worse trade for a
   * small same-origin file the browser will usually serve from its own cache.
   */
  let cachedMeta: DataMeta | undefined;

  async function readMeta(readOptions?: ReadOptions): Promise<DataMeta> {
    if (cachedMeta !== undefined) {
      return cachedMeta;
    }
    const meta = await fetchJson({
      resource: 'dataMeta',
      url: baseUrl + DATA_META_PATH,
      schema: DataMetaSchema,
      fetch: fetchImpl,
      ...(readOptions?.signal ? { signal: readOptions.signal } : {}),
    });
    cachedMeta = meta;
    return meta;
  }

  return {
    kind: 'static' satisfies DataSourceKind,

    getDataMeta(readOptions?: ReadOptions): Promise<DataMeta> {
      return readMeta(readOptions);
    },

    async getRecordBook(bookId: string, readOptions?: ReadOptions): Promise<RecordBook | null> {
      const artifactId = RECORD_BOOK_ARTIFACT_PREFIX + bookId;
      const reference = resolveArtifact(await readMeta(readOptions), artifactId);
      if (reference === null) {
        return null;
      }
      return fetchJson({
        // The identifier is safe to name in an error only because it was found
        // in the index, which validated its shape. An unknown one never reaches
        // here.
        resource: artifactId,
        url: baseUrl + reference.path,
        schema: RecordBookSchema,
        fetch: fetchImpl,
        ...(readOptions?.signal ? { signal: readOptions.signal } : {}),
      });
    },
  };
}

/**
 * Looks an artifact up in the index, or reports that it is not published.
 *
 * `Object.hasOwn` rather than a plain property read: the index comes from
 * `JSON.parse`, so it inherits `Object.prototype`, and an identifier of
 * `constructor` or `toString` would otherwise return an inherited value that is
 * not an artifact reference at all. The type would not catch it -- the lookup
 * is typed as returning a reference -- and the result would be a request built
 * from `undefined`.
 */
function resolveArtifact(meta: DataMeta, artifactId: string): ArtifactReference | null {
  if (!Object.hasOwn(meta.artifacts, artifactId)) {
    return null;
  }
  return meta.artifacts[artifactId] ?? null;
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
