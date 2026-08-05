// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

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
    'records-example-state-female-raw': {
      path: 'artifacts/records-example-state-female-raw.0123456789abcdef.json',
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
    'conversions-example': {
      path: 'artifacts/conversions-example.76543210fedcba98.json',
      sha256: '3'.repeat(64),
      byteLength: 384,
      schemaVersion: 1,
    },
    // Not slugged from a federation, unlike every other name here. There is one
    // book holding every profile; see the note on `getMeetRuleProfiles`.
    'meet-rules': {
      path: 'artifacts/meet-rules.13579bdf2468ace0.json',
      sha256: '4'.repeat(64),
      byteLength: 640,
      schemaVersion: 1,
    },
    // Also a constant name, and for the same reason as the rule book.
    'qualifying-meets': {
      path: 'artifacts/qualifying-meets.579bdf2468ace013.json',
      sha256: '7'.repeat(64),
      byteLength: 704,
      schemaVersion: 1,
    },
    // Two of the results archive: the fixed-name document that says whether
    // there is an archive at all, and exactly one of its several hundred hash
    // buckets. Publishing one bucket is the realistic case -- a reader fetches
    // the one its name hashes into and nothing else.
    'athlete-mirror': {
      path: 'artifacts/athlete-mirror.2468ace013579bdf.json',
      sha256: '5'.repeat(64),
      byteLength: 320,
      schemaVersion: 1,
    },
    'athletes-191': {
      path: 'artifacts/athletes-191.ace013579bdf2468.json',
      sha256: '6'.repeat(64),
      byteLength: 1024,
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
  levels: [{ id: 'state', label: 'State', regions: [{ id: 'north', label: 'North' }] }],
  disciplines: [{ id: 'full-power', label: 'Full power', lifts: ['squat', 'bench', 'deadlift'] }],
};

/**
 * A published shard with no records in it.
 *
 * Empty because this file is about how a book is *addressed and fetched*, not
 * about what is in one -- the margin figures and the table list are here only
 * because the contract requires them, and are written out rather than spread
 * from a helper so that a field added to the contract fails this file loudly
 * instead of being filled in with a default nobody chose. Every figure is
 * invented (§5.1).
 */
const RECORD_BOOK = {
  id: 'records-example-state-female-raw',
  label: 'Example state records',
  minimumIncrementKilograms: 0.5,
  higherSanctionIncrementKilograms: 2.5,
  matchTakesUnclaimedLevelIds: [],
  sourceTables: [],
  records: [],
};

/**
 * The published shard the fixture index points at: one level, no region, one
 * lifter's sex and equipment category.
 *
 * Written out rather than derived so the test states the caller's side of the
 * contract independently. If the naming ever changed, deriving it here would
 * keep this test passing while the published files moved.
 */
const PUBLISHED: RecordSetQuery = {
  bookId: 'example',
  levelId: 'state',
  regionId: null,
  sex: 'female',
  equipmentId: 'raw',
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

const ARTIFACT_URL = '/data/artifacts/records-example-state-female-raw.0123456789abcdef.json';

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

  it.each([
    ['sex', { sex: 'male' } as const],
    ['equipment category', { equipmentId: 'single-ply' } as const],
  ])('reaches a different shard for a different %s', async (_axis, difference) => {
    // These two are in the query because they are in the shard key, and they are
    // in the shard key because the corpus does not fit without them. An adapter
    // that dropped either would answer a male lifter with the female records
    // under a name that resolved -- plausible figures, tens of kilograms out,
    // with nothing on screen to indicate it.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });

    await expect(source.getRecords({ ...PUBLISHED, ...difference })).resolves.toBeNull();
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
    expect(error.message).toBe('Could not read "records-example-state-female-raw": http 404');
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

const CONVERSIONS_URL = '/data/artifacts/conversions-example.76543210fedcba98.json';

/** Invented rows. The real chart is transcribed once, in `data/sources/`. */
const CONVERSION_CHART = {
  id: 'example',
  label: 'Example Federation',
  source: {
    label: 'Example Federation Conversion Chart',
    url: 'https://example.test/chart/',
    revision: '2026-01',
    verifiedOn: '2026-08-01',
  },
  rows: [
    { kilograms: 100, pounds: 220 },
    { kilograms: 110, pounds: 240 },
  ],
};

describe('conversion chart', () => {
  const routes = { '/data/meta.json': VALID_META, [CONVERSIONS_URL]: CONVERSION_CHART };

  it('resolves one federation’s chart through the index', async () => {
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getConversionChart('example')).resolves.toEqual(CONVERSION_CHART);
    expect(fetch.calls).toEqual(['/data/meta.json', CONVERSIONS_URL]);
  });

  it('answers null for a federation with no published chart', async () => {
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });
    await expect(source.getConversionChart('nowhere')).resolves.toBeNull();
  });

  it('answers null without a request when nothing can be named', async () => {
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getConversionChart('///')).resolves.toBeNull();
    expect(fetch.calls).toEqual([]);
  });

  it('refuses a chart whose citation is not https', async () => {
    // The citation is rendered into an `href`. A `javascript:` URL published by
    // accident would run when a lifter tapped the source line, and it validates
    // as a URL.
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [CONVERSIONS_URL]: {
          ...CONVERSION_CHART,
          source: { ...CONVERSION_CHART.source, url: 'javascript:alert(1)' },
        },
      }),
    });

    await expect(source.getConversionChart('example')).rejects.toThrow(DataSourceError);
  });

  it('refuses a chart of one row', async () => {
    // "The rows around this weight" has no answer in a one-row table, and the
    // whole between-rows behaviour is built on there being one.
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [CONVERSIONS_URL]: { ...CONVERSION_CHART, rows: [CONVERSION_CHART.rows[0]] },
      }),
    });

    await expect(source.getConversionChart('example')).rejects.toThrow(DataSourceError);
  });
});

const MEET_RULES_URL = '/data/artifacts/meet-rules.13579bdf2468ace0.json';

/**
 * An invented federation. A 2 kg bar multiple where every real profile published
 * from this repository uses 2.5, so nothing here can be mistaken for a
 * transcription of anybody's rulebook.
 */
const MEET_RULE_BOOK = {
  profiles: [
    {
      id: 'example',
      label: 'Example Federation',
      source: {
        label: 'Example Federation Technical Rules',
        url: 'https://example.test/rulebook.pdf',
        revision: '2026v1',
        verifiedOn: '2026-08-01',
      },
      attemptsPerLift: 3,
      barMultipleKilograms: 2,
      minimumProgressionKilograms: 2,
      recordProgressionKilograms: 0.25,
      submissionSeconds: 90,
      automaticAfterGoodLift: 'increase-by-increment',
      automaticAfterMiss: 'repeat',
      forbidsAttemptBelowFailedWeight: true,
      risingBar: true,
      attemptResearchPopulation: false,
      openerChange: {
        allowed: 1,
        firstGroupMinutesBefore: 4,
        laterGroupAttemptsBefore: 6,
        summary: 'One change, up to four minutes before the first round of that lift.',
      },
      secondAttemptChangesAllowed: 0,
      thirdAttemptChanges: [
        {
          lift: 'deadlift',
          allowed: 2,
          lapsesOnceCalledToLoadedBar: true,
          notBelowPrecedingLifter: true,
        },
      ],
      formatOverrides: [],
      fourthAttempt: null,
      tieBreak: ['lighter-bodyweight', 'declared-tie'],
      notes: [],
    },
  ],
};

describe('meet rule profiles', () => {
  const routes = { '/data/meta.json': VALID_META, [MEET_RULES_URL]: MEET_RULE_BOOK };

  it('resolves the whole book through the index, with no identifier to supply', async () => {
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getMeetRuleProfiles()).resolves.toEqual(MEET_RULE_BOOK);
    expect(fetch.calls).toEqual(['/data/meta.json', MEET_RULES_URL]);
  });

  it('answers null when a build published no profiles', async () => {
    // The publisher refuses an empty book, so this should not happen -- but a
    // screen still has to tell it apart from a failed read, because only one of
    // the two is worth offering a reload for.
    const { 'meet-rules': _omitted, ...withoutMeetRules } = VALID_META.artifacts;
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': { ...VALID_META, artifacts: withoutMeetRules },
      }),
    });
    await expect(source.getMeetRuleProfiles()).resolves.toBeNull();
  });

  it('refuses a book with no profiles in it', async () => {
    // A book that parsed with an empty list would render as a federation question
    // with no answers -- a form nobody can submit, which reads as a working page.
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({ '/data/meta.json': VALID_META, [MEET_RULES_URL]: { profiles: [] } }),
    });

    await expect(source.getMeetRuleProfiles()).rejects.toThrow(DataSourceError);
  });

  it('refuses a profile whose citation is not https', async () => {
    // Rendered into an `href` beside every rule the tool states. A
    // `javascript:` URL published by accident validates as a URL and runs when a
    // lifter taps the source line.
    const [profile] = MEET_RULE_BOOK.profiles;
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [MEET_RULES_URL]: {
          profiles: [{ ...profile, source: { ...profile?.source, url: 'javascript:alert(1)' } }],
        },
      }),
    });

    await expect(source.getMeetRuleProfiles()).rejects.toThrow(DataSourceError);
  });
});

const QUALIFYING_MEETS_URL = '/data/artifacts/qualifying-meets.579bdf2468ace013.json';

/**
 * An invented federation's criteria for an invented meet.
 *
 * Invented for §5.1's reason and for one more that is specific to this corpus: a
 * real meet's criteria are a page somebody edits, and a fixture holding them
 * keeps asserting a closed qualifying window long after the announcement moved.
 */
const QUALIFYING_MEET_BOOK = {
  federations: [
    {
      federationId: 'example',
      label: 'Example Federation',
      weightClass: {
        mayMoveUp: true,
        moveUpRequiresHigherStandard: true,
        mayMoveDown: false,
        moveUpRequiresVacancy: true,
        quotation:
          'A lifter may move up one class with that class total and a place on the roster.',
      },
      gearLadder: [
        { competedIn: 'Example Raw', standardReachedIn: 'Example Raw', opens: ['Example Raw'] },
      ],
      testedCrossoverAllowed: null,
      conditions: [],
      source: {
        label: 'Example Federation Technical Rules',
        url: 'https://example.test/rulebook.pdf',
        revision: '2026v1',
        sections: ['5.1.10 (a)'],
        verifiedOn: '2026-08-01',
      },
    },
  ],
  meets: [
    {
      id: 'example-championship-2027',
      label: 'Example Federation Championship 2027',
      federationId: 'example',
      sanctionedBy: 'Example Federation',
      held: { from: '2027-01-16', to: '2027-01-17' },
      location: 'Example Hall, Nowhere',
      sanctionNumber: null,
      offerings: [{ discipline: 'Full Power', equipment: ['Example Raw'] }],
      testedOffering: 'both',
      entryClosesOn: '2027-01-02',
      entry: {
        kind: 'standard',
        routes: [
          {
            id: 'class-total',
            label: 'Class total',
            standard: {
              kind: 'classification',
              standardId: 'example-class',
              orAbove: true,
              divisionBasis: 'lifters-age-division',
            },
            performance: {
              federationNames: null,
              tested: null,
              territory: null,
              description: 'From an Example Federation event.',
            },
            window: { from: '2026-01-01', to: '2026-12-31' },
            appliesToTested: null,
            quotation: 'An Example Class total or above is required to qualify.',
            dispute: null,
          },
        ],
      },
      conditions: [],
      source: {
        label: 'Example Federation Championship 2027',
        url: 'https://example.test/championship-2027/',
        verifiedOn: '2026-08-05',
      },
    },
  ],
};

describe('qualifying meets', () => {
  const routes = { '/data/meta.json': VALID_META, [QUALIFYING_MEETS_URL]: QUALIFYING_MEET_BOOK };

  it('resolves the whole book through the index, with no identifier to supply', async () => {
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getQualifyingMeets()).resolves.toEqual(QUALIFYING_MEET_BOOK);
    expect(fetch.calls).toEqual(['/data/meta.json', QUALIFYING_MEETS_URL]);
  });

  it('answers null when a build has transcribed no meets', async () => {
    // A real state and not a failure: the criteria are transcribed by hand, so a
    // build with none is a qualification screen that says so. Distinguishable
    // from a failed read, because only one of the two is worth a reload button.
    const { 'qualifying-meets': _omitted, ...withoutMeets } = VALID_META.artifacts;
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({ '/data/meta.json': { ...VALID_META, artifacts: withoutMeets } }),
    });
    await expect(source.getQualifyingMeets()).resolves.toBeNull();
  });

  it('refuses a book of meets with no federation rules behind them', async () => {
    // Whether a lifter may enter turns on the weight-class and gear rules as much
    // as on the total. A book without them draws a fraction of the criteria while
    // looking complete, which is the failure this screen exists to not commit.
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [QUALIFYING_MEETS_URL]: { ...QUALIFYING_MEET_BOOK, federations: [] },
      }),
    });

    await expect(source.getQualifyingMeets()).rejects.toThrow(DataSourceError);
  });

  it('refuses a meet whose citation is not https', async () => {
    // Rendered into an `href` under the criteria a lifter is deciding on. A
    // `javascript:` URL validates as a URL and runs when they tap the source line.
    const [meet] = QUALIFYING_MEET_BOOK.meets;
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [QUALIFYING_MEETS_URL]: {
          ...QUALIFYING_MEET_BOOK,
          meets: [{ ...meet, source: { ...meet?.source, url: 'javascript:alert(1)' } }],
        },
      }),
    });

    await expect(source.getQualifyingMeets()).rejects.toThrow(DataSourceError);
  });
});

const MIRROR_URL = '/data/artifacts/athlete-mirror.2468ace013579bdf.json';
const BUCKET_URL = '/data/artifacts/athletes-191.ace013579bdf2468.json';

/** Invented. Nobody has competed under any of this (§5.1). */
const MIRROR_INFO = {
  id: 'athlete-mirror',
  label: 'Competition results archive',
  attribution: 'This page uses data from the Invented project.',
  sourceUrl: 'https://example.test/invented-latest.zip',
  scopeNote: 'Lifters with at least one result under an invented federation.',
  athleteCount: 2,
  entryCount: 2,
};

/** One mirrored result, written out so a field added to the contract fails loudly. */
const ENTRY = {
  date: '2026-03-14',
  federation: 'INVF',
  parentFederation: null,
  meetName: 'Invented Open',
  event: 'SBD',
  equipment: 'Raw',
  division: null,
  ageClass: null,
  age: null,
  tested: null,
  sex: 'F',
  bodyweightKg: 60,
  weightClassKg: '60',
  squatKg: 100,
  benchKg: 60,
  deadliftKg: 120,
  totalKg: 280,
  place: '1',
};

/**
 * The one bucket the fixture index publishes, holding two lifters.
 *
 * `Kestrel Vale` and `Kestrel  Vale` are two people whose names fold to one key,
 * which is the case this seam exists to keep apart. `Sable Mabry` is in the same
 * bucket only because the hash put them there -- a bucket is a hash partition and
 * means nothing to a reader, so a shard always holds strangers.
 *
 * All three names really do hash into 191 under `athleteShardBucket`, and the
 * bucket is written out here as a literal rather than computed, so that the test
 * states the published side of the contract independently. Computing it would
 * keep this passing while the published files moved.
 */
const BUCKET = {
  bucket: 191,
  bucketCount: 512,
  athletes: [
    { key: 'kestrelvale', name: 'Kestrel  Vale', entries: [ENTRY] },
    { key: 'kestrelvale', name: 'Kestrel Vale', entries: [ENTRY] },
    { key: 'sablemabry', name: 'Sable Mabry', entries: [ENTRY] },
  ],
};

describe('the results archive', () => {
  const routes = {
    '/data/meta.json': VALID_META,
    [MIRROR_URL]: MIRROR_INFO,
    [BUCKET_URL]: BUCKET,
  };

  it('answers what archive this build published before any name is typed', async () => {
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.getAthleteMirror()).resolves.toEqual(MIRROR_INFO);
    expect(fetch.calls).toEqual(['/data/meta.json', MIRROR_URL]);
  });

  it('answers null when a build published no archive at all', async () => {
    // Not an error and not "nobody by that name". The archive is an optional
    // part of a build -- it is large and it comes from outside -- and a screen
    // that offers to search one that is not there is offering a control that can
    // only disappoint. `null` means draw the manual route and no search box.
    const { 'athlete-mirror': _omitted, ...withoutMirror } = VALID_META.artifacts;
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({ '/data/meta.json': { ...VALID_META, artifacts: withoutMirror } }),
    });

    await expect(source.getAthleteMirror()).resolves.toBeNull();
  });

  it('refuses an archive whose source link is not https', async () => {
    // Rendered into an `href` beside the credit its licence asks for. A
    // `javascript:` URL published by accident validates as a URL and runs when
    // somebody taps the attribution line.
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [MIRROR_URL]: { ...MIRROR_INFO, sourceUrl: 'javascript:alert(1)' },
      }),
    });

    await expect(source.getAthleteMirror()).rejects.toThrow(DataSourceError);
  });

  it('fetches only the bucket the typed name hashes into, and returns only that lifter', async () => {
    // Two claims, and they are the same claim from either end. A reader
    // downloads one file of several hundred and nothing enumerates the rest --
    // and a bucket is a hash partition, so most of what arrives in it is
    // strangers. Returning the file's contents would answer a search for one
    // lifter with a list of everyone the hash happened to seat beside them.
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    const found = await source.findAthletes('Sable Mabry');

    expect(found).toEqual({ outcome: 'found', matches: [BUCKET.athletes[2]] });
    expect(fetch.calls).toEqual(['/data/meta.json', BUCKET_URL]);
  });

  it('takes what a person typed, not a key', async () => {
    // Folding a name is a property of how the archive is indexed, so it happens
    // below the seam. A caller that pre-normalised would be a caller that breaks
    // when the indexing changes -- and the symptom of the two drifting apart is
    // a lookup that finds nobody, which is a real answer for most names and so
    // would never be investigated.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });

    await expect(source.findAthletes('  SABLE   mabry  ')).resolves.toEqual({
      outcome: 'found',
      matches: [BUCKET.athletes[2]],
    });
  });

  it('returns every lifter whose name folds to the same key', async () => {
    // Two people, and the caller has to show both. Picking one would put
    // somebody else's total on the screen that tells a lifter whether they may
    // enter a meet (§5.5, ambiguity is an outcome and not a tie to break). Note
    // that both spellings ask the same question, because the fold is what the
    // question is asked in.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });
    const both = { outcome: 'found', matches: [BUCKET.athletes[0], BUCKET.athletes[1]] };

    await expect(source.findAthletes('Kestrel Vale')).resolves.toEqual(both);
    await expect(source.findAthletes('Kestrel  Vale')).resolves.toEqual(both);
  });

  it('says a name is unusable rather than searching for nothing', async () => {
    // A name in a script the index does not fold to Latin letters. There is no
    // key, so there is no bucket -- and "we cannot look that up" is a different
    // sentence from "nobody is called that", because only one of them is worth
    // suggesting another spelling for.
    const fetch = routingFetch(routes);
    const source = createStaticDataSource({ baseUrl: '/data/', fetch });

    await expect(source.findAthletes('\u4e2d\u6587')).resolves.toEqual({ outcome: 'unusable' });
    // And it costs nothing. Not even the index is read.
    expect(fetch.calls).toEqual([]);
  });

  it('reports an unpublished bucket as nobody, not as a failure', async () => {
    // Most buckets are absent from a build that published a small archive, and a
    // reader asking for one is asking a perfectly ordinary question. The prior
    // question -- is there an archive at all -- was already answered by
    // `getAthleteMirror`.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });

    await expect(source.findAthletes('Wren Ashby')).resolves.toEqual({
      outcome: 'found',
      matches: [],
    });
  });

  it('reports a published bucket holding nobody by that name as nobody', async () => {
    // `Merrow Ottersby` hashes into 191 and is not in it. The same answer as an
    // unpublished bucket, reached the other way, and the reason the outcome does
    // not distinguish them: which of the two happened is a fact about how the
    // archive was partitioned, and no screen has anything different to say.
    const source = createStaticDataSource({ baseUrl: '/data/', fetch: routingFetch(routes) });

    await expect(source.findAthletes('Merrow Ottersby')).resolves.toEqual({
      outcome: 'found',
      matches: [],
    });
  });

  it('refuses a shard that does not match the contract', async () => {
    // A bomb-out written as a zero rather than as `null` is the exact coercion
    // the contract forbids, and it would put a lifter at the bottom of a ladder
    // they were never on.
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: routingFetch({
        '/data/meta.json': VALID_META,
        [BUCKET_URL]: {
          ...BUCKET,
          athletes: [
            { key: 'kestrelvale', name: 'Kestrel Vale', entries: [{ ...ENTRY, squatKg: 0 }] },
          ],
        },
      }),
    });

    await expect(source.findAthletes('Kestrel Vale')).rejects.toThrow(DataSourceError);
  });

  it('keeps the typed name out of a failed read', async () => {
    // Section 2.3, and the enforcement is structural: `DataSourceError` names the
    // artifact it was reading and has nowhere to put the input. A search box
    // wired to an error reporter would otherwise ship a name off the device on
    // every flaky request.
    const source = createStaticDataSource({
      baseUrl: '/data/',
      fetch: (input: string) =>
        Promise.resolve(
          input === '/data/meta.json' ? jsonResponse(VALID_META) : jsonResponse({}, 503),
        ),
    });

    const error = await rejection(source.findAthletes('Kestrel Vale'));

    expect(error.message).not.toContain('Kestrel');
    expect(error.message).toBe('Could not read "athletes-191": http 503');
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
