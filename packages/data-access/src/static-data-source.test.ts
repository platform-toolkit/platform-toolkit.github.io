import { describe, expect, it } from 'vitest';

import {
  DataSourceError,
  type ClassificationSetQuery,
  type RecordSetQuery,
} from './data-source.js';
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
  artifacts: {
    'categories-example': {
      path: 'artifacts/categories-example.fedcba9876543210.json',
      sha256: '1'.repeat(64),
      byteLength: 256,
      schemaVersion: 1,
    },
    'records-example-state': {
      path: 'artifacts/records-example-state.0123456789abcdef.json',
      sha256: '0'.repeat(64),
      byteLength: 128,
      schemaVersion: 1,
    },
    'classifications-example-female-raw': {
      path: 'artifacts/classifications-example-female-raw.89abcdef01234567.json',
      sha256: '2'.repeat(64),
      byteLength: 512,
      schemaVersion: 1,
    },
  },
};

/** Invented figures. Real federation boundaries belong in published data. */
const CATALOG = {
  id: 'example',
  label: 'Example Federation',
  equipment: [{ id: 'raw', label: 'Raw' }],
  weightClassLadders: [
    {
      id: 'example-female',
      label: 'Female classes',
      sex: 'female',
      classes: [{ id: 'f-56', label: '56 kg', maximumKilograms: 56 }],
    },
  ],
  ageDivisions: {
    id: 'example-divisions',
    label: 'Divisions',
    basis: 'age-on-meet-date',
    divisions: [{ id: 'open', label: 'Open', minimumAge: null, maximumAge: null }],
  },
};

const RECORD_BOOK = {
  id: 'records-example-state',
  label: 'Example state records',
  minimumIncrementKilograms: 0.5,
  records: [],
};

/**
 * The published shard the fixture index points at: one level, no region.
 *
 * Written out rather than derived so the test states the caller's side of the
 * contract independently. If the naming ever changed, deriving it here would
 * keep this test passing while the published files moved.
 */
const PUBLISHED: RecordSetQuery = { bookId: 'example', levelId: 'state', regionId: null };

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

/** Serves a body per URL, and 404s anything else. */
function routingFetch(routes: Record<string, unknown>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (input: string): Promise<Response> => {
    calls.push(input);
    return Promise.resolve(
      Object.hasOwn(routes, input) ? jsonResponse(routes[input]) : jsonResponse({}, 404),
    );
  };
  return Object.assign(impl, { calls });
}

const ARTIFACT_URL = '/data/artifacts/records-example-state.0123456789abcdef.json';

describe('artifact resolution', () => {
  const routes = { '/data/meta.json': VALID_META, [ARTIFACT_URL]: RECORD_BOOK };

  it('resolves a level and region through the published index', async () => {
    // The caller never supplies a path. It names records, and the index -- a
    // same-origin document CI wrote, validated on read -- says where they live.
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getRecords(PUBLISHED)).resolves.toEqual(RECORD_BOOK);
    expect(fetch.calls).toEqual(['/data/meta.json', ARTIFACT_URL]);
  });

  it('reaches a different shard for a different region', async () => {
    // Level and region choose the file. A source that ignored the region would
    // answer every state with whichever shard it happened to resolve first, and
    // a lifter in Ohio would be measured against Iowa's records.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });

    await expect(source.getRecords({ ...PUBLISHED, regionId: 'ohio' })).resolves.toBeNull();
  });

  it('answers null for records that are not published', async () => {
    // Not a failure. "No records here" and "could not load records" are
    // different things to put on a screen.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });
    await expect(source.getRecords({ ...PUBLISHED, bookId: 'nowhere' })).resolves.toBeNull();
  });

  it('answers null without a request when nothing can be named', async () => {
    // Punctuation only: no artifact could ever have been published under it, so
    // the index does not need consulting to know that.
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getRecords({ ...PUBLISHED, levelId: '///' })).resolves.toBeNull();
    expect(fetch.calls).toEqual([]);
  });

  it('does not treat an inherited property as an artifact', async () => {
    // The index comes from JSON.parse, so it inherits Object.prototype. A plain
    // property read would answer `constructor` with a function, and the request
    // would then be built from `undefined`. The artifact prefix happens to make
    // this unreachable through a query today; the `Object.hasOwn` guard is what
    // keeps it unreachable when a later artifact kind is named differently.
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    for (const bookId of ['constructor', 'toString', '__proto__']) {
      await expect(source.getRecords({ ...PUBLISHED, bookId }), bookId).resolves.toBeNull();
    }
    expect(fetch.calls).toEqual(['/data/meta.json']);
  });

  it('validates the artifact against its own contract', async () => {
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [ARTIFACT_URL]: { ...RECORD_BOOK, minimumIncrementKilograms: -1 },
      }),
    });
    await expect(source.getRecords(PUBLISHED)).rejects.toThrow(DataSourceError);
  });

  it('reads the index once, so one screen shows one build', async () => {
    // Two reads either side of a deploy would otherwise mix an old record book
    // with a new classification table, and nothing would look wrong. It matters
    // more now that records are sharded: a screen comparing a lifter against
    // state and national records reads two artifacts, and they must be the two
    // the same build published.
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await source.getDataMeta();
    await source.getRecords(PUBLISHED);
    await source.getDataMeta();

    expect(fetch.calls.filter((url) => url.endsWith('meta.json'))).toHaveLength(1);
  });

  it('does not cache a failed index read', async () => {
    let attempt = 0;
    const fetch: FetchLike = (input: string) => {
      attempt += 1;
      if (attempt === 1) return Promise.resolve(jsonResponse({}, 503));
      return Promise.resolve(
        input.endsWith('meta.json') ? jsonResponse(VALID_META) : jsonResponse(RECORD_BOOK),
      );
    };
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getDataMeta()).rejects.toThrow(DataSourceError);
    await expect(source.getDataMeta()).resolves.toEqual(VALID_META);
  });

  it('names the artifact, not its URL, when a read fails', async () => {
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({ '/data/meta.json': VALID_META }),
    });

    const error = await rejection(source.getRecords(PUBLISHED));
    expect(error.message).toBe('Could not read "records-example-state": http 404');
  });
});

const CATALOG_URL = '/data/artifacts/categories-example.fedcba9876543210.json';

describe('category catalogue', () => {
  const routes = { '/data/meta.json': VALID_META, [CATALOG_URL]: CATALOG };

  it('resolves a federation catalogue through the same index', async () => {
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getCategoryCatalog('example')).resolves.toEqual(CATALOG);
    expect(fetch.calls).toEqual(['/data/meta.json', CATALOG_URL]);
  });

  it('answers null for a federation with no published catalogue', async () => {
    // Distinct from a failure, and the screen says so: "this federation's
    // categories have not been published yet" rather than an empty set of
    // questions, which reads as a broken page.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });
    await expect(source.getCategoryCatalog('nowhere')).resolves.toBeNull();
  });

  it('answers null without a request when nothing can be named', async () => {
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getCategoryCatalog('///')).resolves.toBeNull();
    expect(fetch.calls).toEqual([]);
  });

  it('refuses a catalogue that does not match its contract', async () => {
    // A federation published with no weight classes would otherwise draw a
    // question with no answers. Failing the read is what makes that visible.
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [CATALOG_URL]: { ...CATALOG, weightClassLadders: [] },
      }),
    });

    await expect(source.getCategoryCatalog('example')).rejects.toThrow(DataSourceError);
  });

  it('shares one index read with the records on the same screen', async () => {
    // The catalogue draws the controls and the records answer them. Reading the
    // index twice could straddle a deploy and pair a new weight class with a
    // record book that has never heard of it.
    const fetch = routingFetch({ ...routes, [ARTIFACT_URL]: RECORD_BOOK });
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await source.getCategoryCatalog('example');
    await source.getRecords(PUBLISHED);

    expect(fetch.calls.filter((url) => url.endsWith('meta.json'))).toHaveLength(1);
  });
});

const CLASSIFICATIONS_URL =
  '/data/artifacts/classifications-example-female-raw.89abcdef01234567.json';

/** Invented figures, and deliberately not a plausible ladder shape. */
const CLASSIFICATION_BOOK = {
  id: 'example',
  label: 'Example Federation',
  tables: [
    {
      id: 'example-female-raw-total-open',
      label: 'Women, Raw Total, Open',
      scope: {
        sex: 'female',
        lift: 'total',
        equipmentId: 'raw',
        weightClassId: null,
        divisionId: 'open',
        tested: null,
      },
      standards: [{ id: 'first', label: 'First', rank: 0, requiredKilograms: 100 }],
    },
  ],
};

const PARTITION: ClassificationSetQuery = {
  federationId: 'example',
  sex: 'female',
  equipmentId: 'raw',
};

describe('classification standards', () => {
  const routes = { '/data/meta.json': VALID_META, [CLASSIFICATIONS_URL]: CLASSIFICATION_BOOK };

  it('resolves a sex and equipment partition through the same index', async () => {
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getClassifications(PARTITION)).resolves.toEqual(CLASSIFICATION_BOOK);
    expect(fetch.calls).toEqual(['/data/meta.json', CLASSIFICATIONS_URL]);
  });

  it('reaches a different partition for a different equipment category', async () => {
    // Both axes choose the file. An adapter that dropped one would answer every
    // equipment category with whichever partition it resolved first, and a raw
    // lifter would be measured against multi-ply standards -- a difference of
    // tens of kilograms that still looks like a plausible table.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });

    await expect(
      source.getClassifications({ ...PARTITION, equipmentId: 'multi-ply' }),
    ).resolves.toBeNull();
    await expect(source.getClassifications({ ...PARTITION, sex: 'male' })).resolves.toBeNull();
  });

  it('answers null for a category with no published standards', async () => {
    // Already true of several real categories, which is why it must not be a
    // failure: the screen says the federation publishes none for them.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });
    await expect(
      source.getClassifications({ ...PARTITION, federationId: 'nowhere' }),
    ).resolves.toBeNull();
  });

  it('answers null without a request when nothing can be named', async () => {
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(
      source.getClassifications({ ...PARTITION, equipmentId: '///' }),
    ).resolves.toBeNull();
    expect(fetch.calls).toEqual([]);
  });

  it('refuses a book whose standards do not match their contract', async () => {
    // A standard requiring zero kilograms would place every lifter at it, and
    // the screen would tell them they had earned a title for turning up.
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [CLASSIFICATIONS_URL]: {
          ...CLASSIFICATION_BOOK,
          tables: [
            {
              ...CLASSIFICATION_BOOK.tables[0],
              standards: [{ id: 'first', label: 'First', rank: 0, requiredKilograms: 0 }],
            },
          ],
        },
      }),
    });

    await expect(source.getClassifications(PARTITION)).rejects.toThrow(DataSourceError);
  });

  it('shares one index read with the catalogue that drew the controls', async () => {
    // The catalogue offers the equipment categories and this read is keyed by
    // the one chosen. Two index reads could straddle a deploy and pair a
    // category with a partition published before it existed.
    const fetch = routingFetch({ ...routes, [CATALOG_URL]: CATALOG });
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await source.getCategoryCatalog('example');
    await source.getClassifications(PARTITION);

    expect(fetch.calls.filter((url) => url.endsWith('meta.json'))).toHaveLength(1);
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
