import { DataSourceError, type DataSource } from '@platform-toolkit/data-access';

import { dataSource } from '../data-source.js';
import './ptk-target-categories.js';
import type { PtkTargetCategories } from './ptk-target-categories.js';

/** Identifier for this tool, and what it calls itself in a height message. */
export const TOOL_ID = 'platform-targets';

/**
 * The federation whose categories this tool shows.
 *
 * One today, and it is also the segment in the embed route's path
 * (`platform-targets/embed/uspa/`) -- a path segment rather than a query
 * parameter so that each federation gets a cacheable URL and an embedding site
 * cannot silently switch which rules a reader is looking at. When a second
 * federation is published this becomes a per-page value read from that segment;
 * until then a constant is honest and a parser would be guessing at a shape.
 */
export const DEFAULT_FEDERATION_ID = 'uspa';

export interface PlatformTargetsViewOptions {
  /** Defaults to the site's configured source. Injected in tests. */
  readonly source?: DataSource;
  readonly federationId?: string;
}

/**
 * Builds the tool and starts loading what it needs.
 *
 * The element is returned before the read finishes, showing its own loading
 * state, so the page has something with a height immediately -- the embed route
 * reports that height to its parent, and a frame that starts at zero and then
 * jumps is worse than one that starts the size of a sentence.
 */
export function createPlatformTargetsView(
  options: PlatformTargetsViewOptions = {},
): PtkTargetCategories {
  const element = document.createElement('ptk-target-categories');
  const source = options.source ?? dataSource;
  const federationId = options.federationId ?? DEFAULT_FEDERATION_ID;

  void loadCatalog(element, source, federationId);
  return element;
}

async function loadCatalog(
  element: PtkTargetCategories,
  source: DataSource,
  federationId: string,
): Promise<void> {
  try {
    const catalog = await source.getCategoryCatalog(federationId);
    element.catalog = catalog;
    // `null` is an answer, not a failure: nothing is published for this
    // federation yet. Collapsing it into the error state would tell a reader to
    // reload a page that will never load.
    element.status = catalog === null ? 'unavailable' : 'ready';
  } catch (caught) {
    element.status = 'failed';
    reportCatalogFailure(caught);
  }
}

/**
 * Says on the console that the read failed, and says nothing else.
 *
 * The error object is not passed through. A `DataSourceError` carries no URL by
 * construction, but its `cause` is whatever the transport threw, and a console
 * expands a cause chain -- which is exactly where a request URL, and eventually
 * an imported profile URL, would show up. The reason code is the part that helps
 * and the only part that is safe to keep.
 */
function reportCatalogFailure(caught: unknown): void {
  const reason = caught instanceof DataSourceError ? caught.reason : 'unexpected';
  console.error(`Platform Targets could not load the category catalogue: ${reason}.`);
}
