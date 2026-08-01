/**
 * The boundary between "what the application needs to know" and "where that
 * knowledge is stored".
 *
 * Today every answer is a static JSON file published to the same origin as the
 * site. That may not stay true: a database behind an API is a plausible future,
 * and the point of this interface is that the change should not reach the code
 * that asks the questions.
 *
 * Two rules keep that promise cheap, and both are easy to break by accident:
 *
 * 1. Methods here describe *intent*, never mechanism. A caller asks for the
 *    freshness of the published data, not for `/data/meta.json`, and never for
 *    a shard index. Hash sharding is a property of one storage strategy; a
 *    caller that knows the shard count is a caller that has to change when the
 *    storage does.
 *
 * 2. Every method is asynchronous, even where an implementation could answer
 *    immediately. A synchronous read that later becomes a network call rewrites
 *    every call site and every component that renders the result. Paying the
 *    promise now costs nothing and removes that migration entirely.
 *
 * Filtering follows from the same reasoning. A static implementation fetches a
 * published artifact and narrows it in the browser; an API implementation can
 * push the same narrowing into a query. Callers express which slice they want
 * and stay out of the argument.
 */
import type { DataMeta } from '@platform-toolkit/data-contracts';

/** Which strategy is answering. Useful in diagnostics; never for branching logic. */
export type DataSourceKind = 'static' | 'http';

export interface ReadOptions {
  /**
   * Cancels an in-flight read. Present on every method because a component that
   * unmounts mid-request should not keep the request alive, and because a slow
   * source must never be able to wedge a page.
   */
  readonly signal?: AbortSignal;
}

/**
 * Why a read failed, in terms the interface can act on.
 *
 * Deliberately coarse. Callers need to distinguish "try again" from "this will
 * never work" from "the published data is wrong"; anything finer belongs in the
 * implementation that produced it.
 */
export type DataSourceFailureReason =
  /** The request never completed: offline, DNS, TLS, connection reset. */
  | 'network'
  /** The server answered, but not with success. */
  | 'http'
  /** The response arrived and did not match its schema. */
  | 'malformed'
  /** The caller cancelled it. Not an error condition in itself. */
  | 'aborted';

/**
 * A failed read.
 *
 * The message carries the logical resource name, the reason, and -- for HTTP
 * failures -- the status code. It deliberately carries no URL and no fragment of
 * the response body. Error text reaches logs and error reports, and a URL is
 * exactly where an athlete's identity ends up once profile lookups exist; the
 * project's privacy rules forbid putting it there, and the cheapest way to obey
 * that is to give this type no way to hold it.
 */
export class DataSourceError extends Error {
  override readonly name = 'DataSourceError';

  constructor(
    readonly resource: string,
    readonly reason: DataSourceFailureReason,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    const detail = status === undefined ? reason : `${reason} ${status}`;
    super(`Could not read "${resource}": ${detail}`, options);
  }
}

/**
 * Everything the application is allowed to ask for.
 *
 * Adding a resource means adding a method here and implementing it in every
 * adapter, which is the intended friction: the compiler will not let a new
 * capability exist in one strategy and silently not in another.
 */
export interface DataSource {
  readonly kind: DataSourceKind;

  /**
   * Provenance and freshness for every published source.
   *
   * The interface reports "records current as of" per source rather than
   * site-wide, so this is needed on any screen that shows a record or a
   * classification.
   */
  getDataMeta(options?: ReadOptions): Promise<DataMeta>;
}
