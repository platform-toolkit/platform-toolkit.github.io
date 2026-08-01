/**
 * The one place in the browser bundle that performs a network request.
 *
 * Keeping it to one function is what makes the guarantees checkable. Validation
 * on read, failure classification, and the rule that no URL ever reaches an
 * error message are properties of this file rather than habits spread across
 * however many callers eventually exist.
 */
import * as v from 'valibot';

import { DataSourceError } from './data-source.js';

/**
 * The subset of `fetch` this package uses.
 *
 * Narrow on purpose. The global is injectable so tests can supply a fake without
 * reaching for the real network or monkey-patching a global, and so a future
 * HTTP adapter can wrap the same call in retry or auth without either concern
 * leaking in here.
 */
export type FetchLike = (
  input: string,
  init?: { readonly signal?: AbortSignal; readonly headers?: Record<string, string> },
) => Promise<Response>;

export interface FetchJsonRequest<TSchema extends v.GenericSchema> {
  /** Logical name, used in errors. Never a URL. */
  readonly resource: string;
  readonly url: string;
  readonly schema: TSchema;
  readonly fetch: FetchLike;
  readonly signal?: AbortSignal;
}

/**
 * Summarises a validation failure as a list of paths and what was expected
 * there.
 *
 * Valibot's own messages embed the value it received, which is exactly the wrong
 * thing to put in a string that will be logged or sent to an error reporter --
 * once athlete records are being read, the received value is athlete data. Paths
 * and expectations describe the shape mismatch without carrying any of it.
 */
function describeIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => {
      const path = v.getDotPath(issue) ?? '(root)';
      return `${path}: expected ${issue.expected ?? 'a valid value'}`;
    })
    .join('; ');
}

/**
 * Fetches JSON and validates it, or throws {@link DataSourceError}.
 *
 * Data crossing a trust boundary is parsed, never assumed. A source that changes
 * shape has to surface as a visible failure; the alternative is a coerced number
 * quietly becoming a wrong record total on a page someone is using to plan
 * attempts.
 */
export async function fetchJson<TSchema extends v.GenericSchema>({
  resource,
  url,
  schema,
  fetch,
  signal,
}: FetchJsonRequest<TSchema>): Promise<v.InferOutput<TSchema>> {
  // Built conditionally rather than passing `signal: undefined`:
  // `exactOptionalPropertyTypes` treats an explicit undefined as a distinct,
  // and here invalid, value.
  const init = signal ? { signal, headers: JSON_HEADERS } : { headers: JSON_HEADERS };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    throw new DataSourceError(resource, isAbort(cause, signal) ? 'aborted' : 'network', undefined, {
      cause,
    });
  }

  if (!response.ok) {
    throw new DataSourceError(resource, 'http', response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    // A body that is not JSON is a malformed response, not a network problem.
    // Distinguishing them matters to the caller: one is worth retrying and the
    // other never will be.
    throw new DataSourceError(
      resource,
      isAbort(cause, signal) ? 'aborted' : 'malformed',
      undefined,
      {
        cause,
      },
    );
  }

  const result = v.safeParse(schema, body);
  if (!result.success) {
    throw new DataSourceError(resource, 'malformed', undefined, {
      cause: new Error(describeIssues(result.issues)),
    });
  }
  return result.output;
}

const JSON_HEADERS: Record<string, string> = { accept: 'application/json' };

/**
 * Cancellation arrives as a rejection indistinguishable from a network error by
 * type alone. The signal is the reliable witness; the name check covers a fake
 * or a polyfill that rejects without one.
 */
function isAbort(cause: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted === true) return true;
  return cause instanceof Error && cause.name === 'AbortError';
}
