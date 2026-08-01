import { describe, expect, it } from 'vitest';

import { DataSourceError } from './data-source.js';
import type { FetchLike } from './fetch-json.js';
import { createStaticDataSource } from './static-data-source.js';

const VALID_META = {
  schemaVersion: 1,
  generatedAt: '2026-07-31T00:00:00.000Z',
  sources: [
    {
      id: 'uspa-records',
      label: 'USPA national records',
      retrievedAt: '2026-07-31T00:00:00.000Z',
      status: 'ok',
    },
  ],
};

/** Records the URLs it was asked for, so path construction can be asserted. */
function stubFetch(response: () => Response): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (input: string): Promise<Response> => {
    calls.push(input);
    return Promise.resolve(response());
  };
  return Object.assign(impl, { calls });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createStaticDataSource', () => {
  it('reads and validates the published metadata', async () => {
    const fetch = stubFetch(() => jsonResponse(VALID_META));
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getDataMeta()).resolves.toEqual(VALID_META);
    expect(fetch.calls).toEqual(['/data/meta.json']);
  });

  it('reports itself as the static strategy', () => {
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: stubFetch(() => jsonResponse(VALID_META)),
    });
    expect(source.kind).toBe('static');
  });

  it('adds the missing trailing slash rather than joining paths wrongly', async () => {
    const fetch = stubFetch(() => jsonResponse(VALID_META));
    await createStaticDataSource({ baseUrl: '/data', fetch }).getDataMeta();
    expect(fetch.calls).toEqual(['/data/meta.json']);
  });

  it('accepts an absolute https base, for the day the data moves to its own origin', async () => {
    const fetch = stubFetch(() => jsonResponse(VALID_META));
    await createStaticDataSource({ baseUrl: 'https://data.example.invalid', fetch }).getDataMeta();
    expect(fetch.calls).toEqual(['https://data.example.invalid/meta.json']);
  });

  it.each([
    ['http://data.example.invalid/', 'plaintext transport'],
    ['//data.example.invalid/', 'protocol-relative, so it inherits an http page'],
    ['/data/../../elsewhere/', 'path traversal'],
    ['data.example.invalid', 'not a URL or a rooted path'],
  ])('refuses %s (%s)', (baseUrl) => {
    expect(() =>
      createStaticDataSource({ baseUrl, fetch: stubFetch(() => jsonResponse(VALID_META)) }),
    ).toThrow(TypeError);
  });
});

/**
 * Asserts that a read failed, and narrows the result.
 *
 * A bare `.catch(caught => caught)` would let a *successful* read fall through
 * into the assertions below, where it fails for the wrong reason and reads as
 * though the classification were broken.
 */
async function rejection(promise: Promise<unknown>): Promise<DataSourceError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof DataSourceError) return caught;
    throw caught;
  }
  throw new Error('Expected the read to reject, but it resolved.');
}

describe('failure classification', () => {
  const source = (fetch: FetchLike) => createStaticDataSource({ baseUrl: '/data/', fetch });

  it('distinguishes an HTTP failure and keeps the status', async () => {
    const error = await rejection(source(stubFetch(() => jsonResponse({}, 503))).getDataMeta());

    expect(error).toMatchObject({ reason: 'http', status: 503, resource: 'dataMeta' });
  });

  it('treats a transport rejection as a network failure and preserves the cause', async () => {
    const cause = new Error('connection reset');
    const failing: FetchLike = () => Promise.reject(cause);

    const error = await rejection(source(failing).getDataMeta());

    expect(error.reason).toBe('network');
    expect(error.cause).toBe(cause);
  });

  it('treats a response that is not JSON as malformed rather than as a network failure', async () => {
    const error = await rejection(
      source(stubFetch(() => new Response('<!doctype html>', { status: 200 }))).getDataMeta(),
    );

    expect(error.reason).toBe('malformed');
  });

  it('rejects well-formed JSON that does not match the schema', async () => {
    const error = await rejection(
      source(stubFetch(() => jsonResponse({ schemaVersion: 2, sources: [] }))).getDataMeta(),
    );

    expect(error.reason).toBe('malformed');
  });

  it('reports cancellation as its own reason, not as a network failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const failing: FetchLike = () => Promise.reject(new Error('aborted'));

    const error = await rejection(source(failing).getDataMeta({ signal: controller.signal }));

    expect(error.reason).toBe('aborted');
  });

  it('passes the caller signal through to the transport', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const capturing: FetchLike = (_input, init) => {
      seen = init?.signal;
      return Promise.resolve(jsonResponse(VALID_META));
    };

    await source(capturing).getDataMeta({ signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });

  it('keeps the URL and the response body out of the error message', async () => {
    const error = await rejection(
      source(stubFetch(() => jsonResponse({ secretish: 'Jane Lifter' }, 404))).getDataMeta(),
    );

    // Error text reaches logs and error reports. The privacy rules say athlete
    // identity and full URLs must not appear there, and the enforcement is that
    // DataSourceError has nowhere to put them.
    expect(error.message).not.toContain('/data/');
    expect(error.message).not.toContain('Jane Lifter');
    expect(error.message).toBe('Could not read "dataMeta": http 404');
  });
});
