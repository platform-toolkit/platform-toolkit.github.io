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
import type { DataMeta, RecordBook } from '@platform-toolkit/data-contracts';

/** Which strategy is answering. Useful in diagnostics; never for branching logic. */
export type DataSourceKind = 'static' | 'http';

/**
 * Which set of records to load.
 *
 * A *set*, and named as one, because `packages/domain` exports a `RecordQuery`
 * that means something adjacent and different: the eight-axis category one
 * record belongs to. A screen uses both -- this one to load a level's records,
 * that one to find the lifter's within them -- and the two are structurally
 * incompatible, so the compiler catches a swap. The names should not need it to.
 *
 * Level and region because that is what a lifter is actually looking at -- their
 * state's records, then the national ones -- not because of how the data happens
 * to be stored. That the published set is partitioned along the same two axes is
 * a convenience the static adapter exploits privately; an API implementation
 * would turn these into query parameters and a caller could not tell.
 *
 * The finer axes are deliberately absent. A screen shows a lifter their four
 * lifts at once, so narrowing to one sex or one lift here would either cost four
 * reads or push a filter into the interface that every implementation would have
 * to reimplement identically.
 */
export interface RecordSetQuery {
  /** The federation's book, e.g. its published record set. */
  readonly bookId: string;
  /** The level records are kept at: state, national, world. */
  readonly levelId: string;
  /** The region within that level, or `null` where the level has no subdivision. */
  readonly regionId: string | null;
}

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

  /**
   * The records kept at one level and region, or `null` if none are published.
   *
   * `null` is an answer rather than a failure. A federation whose records this
   * project has not yet ingested, or a state that genuinely has no records on
   * the books, is something the interface should say plainly -- distinguishing
   * it from a failed read is what lets the screen choose between "no records
   * here" and "could not load records".
   *
   * The query names records, not a location. A static implementation resolves it
   * through the published index; an API implementation makes it a query string.
   * Neither lets the caller influence a URL directly.
   */
  getRecords(query: RecordSetQuery, options?: ReadOptions): Promise<RecordBook | null>;
}
