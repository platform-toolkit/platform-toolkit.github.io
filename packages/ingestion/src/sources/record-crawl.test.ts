import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  RecordCrawlError,
  componentDocumentUrl,
  decodeTableDocument,
  embedQueryUrl,
  readAreaTargets,
  readEmbedComponent,
  readEmbedQuery,
  readRecordTable,
  readTableTargets,
  targetKey,
} from './record-crawl.js';
import { assertAllowedSourceUrl } from '../fetch-policy.js';

/**
 * Every figure and every name below is invented.
 *
 * Section 5.1: a federation's published numbers live in published artifacts, not
 * in this repository's source. A test that asserted a real state record would
 * also be a copy of it, and it would fail the week somebody set a new one.
 */
const HOLDER = 'Fixture Lifter';

/** A leaf of the table tree, as the embed spells one. */
function field(name: string, value?: string): Record<string, unknown> {
  return value === undefined ? { name, type: 'text' } : { name, value, type: 'text' };
}

/** The same leaf, spelled the other two ways the source spells an empty cell. */
function nullField(name: string): Record<string, unknown> {
  return { name, value: null, type: 'text' };
}

function record(values?: {
  holder?: string;
  kgs?: string;
  lbs?: string;
  date?: string;
}): Record<string, unknown>[] {
  return [
    field('name', values?.holder),
    field('kgs', values?.kgs),
    field('lbs', values?.lbs),
    field('date', values?.date),
  ];
}

const FILLED = record({ holder: HOLDER, kgs: '111.50', lbs: '245.80', date: '03/14/2021' });

function tree(divisions: unknown[], name = 'Level/Status/Region/Gear/Event'): unknown {
  return {
    type: 'form',
    name,
    items: [{ type: 'hierarchy', config: {}, items: divisions }],
  };
}

const ONE_RECORD = tree([
  {
    name: 'OPEN WOMEN',
    items: [{ name: '60kg/132.2lb', items: [{ name: 'Squat', items: FILLED }] }],
  },
]);

/** A stored (uncompressed) single-entry archive, built so a case can be exact. */
function archive(contents: string): Buffer {
  const name = Buffer.from('compressed.txt', 'utf8');
  const body = Buffer.from(contents, 'utf8');
  const checksum = crc32(body);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + body.length, 16);

  return Buffer.concat([local, name, body, central, name, end]);
}

function document(definition: unknown, zipped: boolean): unknown {
  const text = JSON.stringify(definition);
  return {
    fields: {
      zipped: { booleanValue: zipped },
      definition: { stringValue: zipped ? archive(text).toString('base64') : text },
    },
  };
}

describe('readAreaTargets', () => {
  it('reads the areas a page links to', () => {
    const html =
      '<a href="/area.php?location=state&status=drug-tested">A</a>' +
      '<a href="/area.php?location=state&amp;status=non-tested">B</a>';
    expect(readAreaTargets(html)).toEqual([
      { location: 'state', status: 'drug-tested' },
      { location: 'state', status: 'non-tested' },
    ]);
  });

  it('returns each area once however many times it is linked', () => {
    // The site links the same area from a heading and from a button. Crawled
    // twice, one table is published twice under one name.
    const link = '<a href="/area.php?location=iowa&status=drug-tested">Iowa</a>';
    expect(readAreaTargets(link + link)).toHaveLength(1);
  });

  it('ignores links that are not areas', () => {
    expect(readAreaTargets('<a href="https://example.test/area.php">x</a>')).toEqual([]);
  });

  it('refuses a slug that is not one', () => {
    // Nothing read from a page is used as a path. This is where that is enforced
    // for the two values that go into one.
    expect(() => readAreaTargets('<a href="/area.php?location=..&status=x">x</a>')).toThrow(
      RecordCrawlError,
    );
  });
});

describe('readTableTargets', () => {
  it('reads every table an area links to', () => {
    const html =
      '<a href="/records.php?location=iowa&status=drug-tested&event=raw-powerlifting">A</a>' +
      '<a href="/records.php?location=iowa&amp;status=drug-tested&amp;event=raw-bench-only">B</a>';
    expect(readTableTargets(html)).toEqual([
      { location: 'iowa', status: 'drug-tested', event: 'raw-powerlifting' },
      { location: 'iowa', status: 'drug-tested', event: 'raw-bench-only' },
    ]);
  });

  it('names a target the same way twice', () => {
    expect(targetKey({ location: 'iowa', status: 'drug-tested', event: 'raw-powerlifting' })).toBe(
      'iowa/drug-tested/raw-powerlifting',
    );
  });
});

describe('readEmbedQuery', () => {
  const html =
    '<script src="//app.infoweave.io/embed/uspa/ais/public/records/queryget' +
    '?hierarchy_category_id=17&hierarchy_item_id=1&sub_hierarchy_item_id=58"></script>';

  it('reads the three identifiers that name a table', () => {
    expect(readEmbedQuery(html)).toEqual({
      hierarchy_category_id: '17',
      hierarchy_item_id: '1',
      sub_hierarchy_item_id: '58',
    });
  });

  it('reads them through an HTML-escaped query too', () => {
    expect(readEmbedQuery(html.replaceAll('&', '&amp;')).hierarchy_item_id).toBe('1');
  });

  it('takes the parameters and not the address', () => {
    // The load-bearing property of this whole file. A record page that started
    // pointing its embed somewhere else cannot move this crawler, because the
    // host and path it names are never read.
    const moved = html.replace('//app.infoweave.io', 'https://elsewhere.test');
    expect(readEmbedQuery(moved)).toEqual(readEmbedQuery(html));
  });

  it('builds a request only to the permitted vendor', () => {
    const url = embedQueryUrl(readEmbedQuery(html));
    expect(assertAllowedSourceUrl(url).hostname).toBe('app.infoweave.io');
  });

  it('orders the parameters the same way every run', () => {
    // A crawler whose URLs vary run to run defeats every cache between it and
    // the origin, and makes two runs impossible to compare.
    const shuffled = html.replace(
      'hierarchy_category_id=17&hierarchy_item_id=1&sub_hierarchy_item_id=58',
      'sub_hierarchy_item_id=58&hierarchy_category_id=17&hierarchy_item_id=1',
    );
    expect(embedQueryUrl(readEmbedQuery(shuffled))).toBe(embedQueryUrl(readEmbedQuery(html)));
  });

  it.each([
    ['no embed at all', '<p>Records</p>'],
    ['a missing identifier', '<script src="/queryget?hierarchy_category_id=17"></script>'],
    [
      'an identifier that is not a number',
      '<script src="/queryget?hierarchy_category_id=x&hierarchy_item_id=1&sub_hierarchy_item_id=2"></script>',
    ],
  ])('refuses a page with %s', (_case, html_) => {
    expect(() => readEmbedQuery(html_)).toThrow(RecordCrawlError);
  });
});

describe('readEmbedComponent', () => {
  const loader =
    `document.write('<iframe id="content-iframe" ` +
    `src="https://infoweave.io/embed/AppIdent000000000001/InstIdent00000000001/CompIdent00000000001" ` +
    `width="100%"></iframe>');`;

  it('reads the three segments that name a document', () => {
    expect(readEmbedComponent(loader)).toEqual({
      app: 'AppIdent000000000001',
      instance: 'InstIdent00000000001',
      component: 'CompIdent00000000001',
    });
  });

  it('builds a read against the permitted database and nothing else', () => {
    const url = componentDocumentUrl(readEmbedComponent(loader));
    expect(assertAllowedSourceUrl(url).hostname).toBe('firestore.googleapis.com');
    expect(url).toContain('/components/CompIdent00000000001');
  });

  it('does not fetch the address the loader gives', () => {
    // Same discipline as the query: the segments are taken, the origin is not.
    const moved = loader.replace('https://infoweave.io', 'https://elsewhere.test');
    expect(readEmbedComponent(moved)).toEqual(readEmbedComponent(loader));
  });

  it.each([
    ['names no document', 'document.write("<p>unavailable</p>");'],
    ['names a traversal', 'src="https://infoweave.io/embed/../../a/b"'],
    ['names an empty segment', 'src="https://infoweave.io/embed///"'],
  ])('refuses a loader that %s', (_case, body) => {
    expect(() => readEmbedComponent(body)).toThrow(RecordCrawlError);
  });
});

describe('decodeTableDocument', () => {
  it('unpacks a compressed table', () => {
    expect(decodeTableDocument(document(ONE_RECORD, true))).toEqual(ONE_RECORD);
  });

  it('reads an uncompressed one, because the flag says which', () => {
    // Honoured rather than sniffed. A reader that guessed from the first bytes
    // would also guess about a corrupted payload.
    expect(decodeTableDocument(document(ONE_RECORD, false))).toEqual(ONE_RECORD);
  });

  it('refuses a document missing the field the table is in', () => {
    expect(() => decodeTableDocument({ fields: {} })).toThrow(RecordCrawlError);
  });

  it('says which field failed and not what was in it', () => {
    let thrown: unknown;
    try {
      decodeTableDocument({ fields: { definition: { stringValue: HOLDER } } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RecordCrawlError);
    expect((thrown as Error).message).not.toContain(HOLDER);
  });

  it('refuses a payload that is not JSON', () => {
    expect(() =>
      decodeTableDocument({ fields: { definition: { stringValue: 'not json' } } }),
    ).toThrow(/does not hold JSON/);
  });
});

describe('readRecordTable', () => {
  it('reads a record as the four levels that locate it', () => {
    expect(readRecordTable(ONE_RECORD)).toEqual({
      title: 'Level/Status/Region/Gear/Event',
      rows: [
        {
          division: 'OPEN WOMEN',
          weightClass: '60kg/132.2lb',
          lift: 'Squat',
          holder: HOLDER,
          kilograms: '111.50',
          pounds: '245.80',
          date: '03/14/2021',
        },
      ],
      anomalies: [],
    });
  });

  it('carries the table title without interpreting it', () => {
    // The only thing the document says about which table it is, and so the one
    // cross-check available against the identifiers used to reach it. Reading it
    // means knowing the federation's vocabulary, which is the mapping's job.
    expect(
      readRecordTable(tree([], 'State/Drug Tested Records/Iowa/Raw/Raw Full Power')).title,
    ).toBe('State/Drug Tested Records/Iowa/Raw/Raw Full Power');
  });

  it('passes over a lift nobody has set a record in', () => {
    // The normal case, not an anomaly: most classes in most states are empty,
    // and a table that reported each one would report thousands.
    const empty = tree([
      {
        name: 'OPEN MEN',
        items: [{ name: '75kg/165.3lb', items: [{ name: 'Bench', items: record() }] }],
      },
    ]);
    const table = readRecordTable(empty);
    expect(table.rows).toEqual([]);
    expect(table.anomalies).toEqual([]);
  });

  it('reads a table whose empty cells are spelled null', () => {
    // The spelling a third of the real site uses, and the one the first crawl
    // refused every table over. `null` here means the same as an absent field
    // and the same as an empty string: nobody has set this record.
    const nulls = tree([
      {
        name: 'OPEN MEN',
        items: [
          {
            name: '75kg/165.3lb',
            items: [
              {
                name: 'Bench',
                items: [nullField('name'), nullField('kgs'), nullField('lbs'), nullField('date')],
              },
              { name: 'Squat', items: FILLED },
            ],
          },
        ],
      },
    ]);
    const table = readRecordTable(nulls);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.lift).toBe('Squat');
    expect(table.anomalies).toEqual([]);
  });

  it('never files a record whose holder is the word null', () => {
    // The failure the nullable schema invites: treat `null` as present and the
    // row is published with a lifter called "null" against a real weight.
    const halfNull = tree([
      {
        name: 'OPEN MEN',
        items: [
          {
            name: '75kg/165.3lb',
            items: [
              {
                name: 'Squat',
                items: [
                  nullField('name'),
                  field('kgs', '111.50'),
                  field('lbs', '245.80'),
                  field('date', '03/14/2021'),
                ],
              },
            ],
          },
        ],
      },
    ]);
    const table = readRecordTable(halfNull);
    expect(table.rows).toEqual([]);
    expect(table.anomalies).toEqual([
      { path: 'OPEN MEN / 75kg/165.3lb / Squat', reason: 'A record is missing name.' },
    ]);
  });

  it('names a handful of failing positions and counts the rest', () => {
    // A shape change hits every leaf of a kind at once, so an uncapped message
    // is tens of kilobytes of near-identical text per table. The count is the
    // part that says whether this is one odd cell or the whole table.
    const wrongType = tree([
      {
        name: 'OPEN MEN',
        items: Array.from({ length: 20 }, (_unused, index) => ({
          name: `${String(60 + index)}kg`,
          items: [{ name: 'Squat', items: [{ name: 'kgs', value: 111.5, type: 'text' }] }],
        })),
      },
    ]);

    let thrown: unknown;
    try {
      readRecordTable(wrongType);
    } catch (error) {
      thrown = error;
    }
    const message = (thrown as Error).message;
    expect(message.split(';')).toHaveLength(5);
    expect(message).toMatch(/\(and 15 more\)$/);
  });

  it('reports a half-filled record instead of dropping or repairing it', () => {
    const partial = tree([
      {
        name: 'MASTER MEN 50 TO 54',
        items: [
          {
            name: '90kg/198.4lb',
            items: [{ name: 'Deadlift', items: record({ holder: HOLDER, kgs: '200.00' }) }],
          },
        ],
      },
    ]);
    const table = readRecordTable(partial);
    expect(table.rows).toEqual([]);
    expect(table.anomalies).toEqual([
      {
        path: 'MASTER MEN 50 TO 54 / 90kg/198.4lb / Deadlift',
        reason: 'A record is missing lbs, date.',
      },
    ]);
  });

  it('never names the lifter in an anomaly', () => {
    // Section 2.3. An anomaly is written to a CI transcript, and the field it is
    // about is somebody's name.
    const partial = tree([
      {
        name: 'OPEN MEN',
        items: [
          { name: '75kg/165.3lb', items: [{ name: 'Squat', items: record({ holder: HOLDER }) }] },
        ],
      },
    ]);
    expect(JSON.stringify(readRecordTable(partial).anomalies)).not.toContain(HOLDER);
  });

  it('reports a level deeper than the four it reads', () => {
    // A table that grew a level would otherwise come back short, and a record
    // table missing rows looks exactly like one nobody has set records in.
    const deeper = tree([
      {
        name: 'OPEN MEN',
        items: [
          {
            name: '75kg/165.3lb',
            items: [{ name: 'Squat', items: [{ name: 'Attempt 1', items: FILLED }] }],
          },
        ],
      },
    ]);
    const table = readRecordTable(deeper);
    expect(table.rows).toEqual([]);
    expect(table.anomalies).toEqual([
      {
        path: 'OPEN MEN / 75kg/165.3lb / Squat',
        reason: 'A record has a level below it that was not read.',
      },
    ]);
  });

  it('reports a level with no name rather than filing a record under a blank', () => {
    const unnamed = tree([
      { name: 'OPEN MEN', items: [{ items: [{ name: 'Squat', items: FILLED }] }] },
    ]);
    expect(readRecordTable(unnamed).anomalies).toEqual([
      { path: 'OPEN MEN / ? / Squat', reason: 'A level of the table has no name.' },
    ]);
  });

  it('refuses a table with no hierarchy in it', () => {
    expect(() => readRecordTable({ name: 'x', items: [] })).toThrow(/found 0/);
  });

  it('refuses a table with two, rather than picking one', () => {
    expect(() =>
      readRecordTable({ name: 'x', items: [{ type: 'hierarchy' }, { type: 'hierarchy' }] }),
    ).toThrow(/found 2/);
  });

  it('refuses something that is not a table at all', () => {
    expect(() => readRecordTable({ items: [] })).toThrow(RecordCrawlError);
  });
});
