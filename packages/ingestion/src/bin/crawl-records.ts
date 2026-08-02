#!/usr/bin/env node
/**
 * Downloads every USPA record table into one snapshot.
 *
 * Deliberately not part of `publish-data`. The build has to work offline and
 * finish in seconds -- it runs on every developer machine, in every `verify`, and
 * on every pull request -- and a build that crawled three thousand pages would
 * be none of those things, besides making a federation's website a dependency of
 * `pnpm run build`. So this is its own command: it runs on a schedule and when
 * somebody asks, writes a snapshot, and the build reads the snapshot.
 *
 * Nothing here decides what a record means. It writes down what the federation
 * publishes, in the federation's own words, and `data/sources/records/uspa.json`
 * says what those words map to. That separation is the same one the
 * classification standards use, and for the same reason: a crawler that
 * interpreted as it read would have to be re-run to correct a mapping mistake.
 *
 * USAGE
 *
 *   node packages/ingestion/dist/bin/crawl-records.js [--out <path>] [--limit <n>]
 *
 * Run from the repository root. `--limit` stops after that many tables and says
 * so in the output and in the snapshot -- a partial crawl is useful while
 * working on the mapping, and a partial crawl that looked complete would publish
 * a state's records as though the empty ones were empty upstream.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { assertAllowedSourceUrl, SOURCE_FETCH_TIMEOUT_MS } from '../fetch-policy.js';
import { buildRecordTableUrl } from '../sources/record-tables.js';
import { readRecordSourceReferences } from '../sources/records.js';
import {
  componentDocumentUrl,
  decodeTableDocument,
  embedQueryUrl,
  readAreaTargets,
  readEmbedComponent,
  readEmbedQuery,
  readRecordTable,
  readTableTargets,
  targetKey,
  type RawRecordRow,
  type RecordTableAnomaly,
  type RecordTableTarget,
} from '../sources/record-crawl.js';

/** Where the walk starts. The only address in this file that is not derived. */
const INDEX_URL = 'https://records.uspa.net/';

/** Where the snapshot goes unless told otherwise. */
const DEFAULT_OUTPUT = join('data', 'sources', 'records', 'snapshots', 'uspa-records.json');

/**
 * The mapping document, read for one field: the address of a table.
 *
 * The crawl does not otherwise care what the tables mean -- that is the whole
 * separation this file's header describes -- and it reads this anyway, because
 * the published records carry a link to the page each was read from and that link
 * has to be the page this crawl actually fetched. Two copies of the address, one
 * fetched and one published, is a link that rots the day the site moves and a
 * build that never notices, because a build never follows a link. Sharing it
 * means the drift fails the crawl instead, on the first table.
 */
const DEFAULT_MAPPING = join('data', 'sources', 'records', 'uspa.json');

/**
 * How many tables are read at once.
 *
 * Four, and chosen rather than tuned. Each table is three requests to three
 * different hosts, so four in flight is about a dozen open sockets across a
 * federation's small site and a vendor's API -- brisk enough that a full crawl
 * is minutes, quiet enough that nobody has to think about whether this is a
 * well-behaved client. There is no deadline here worth being rude for.
 */
const CONCURRENCY = 4;

/**
 * Attempts per request, and the wait between them.
 *
 * One vendor endpoint answers 503 for tables that were never configured, and it
 * answers it immediately and every time. Retrying is for the transient case; the
 * permanent one costs three quick failures and is then recorded as absent, which
 * is the honest description of a table the site links to and the vendor does not
 * have.
 */
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 750;

/** A redirect chain longer than this is a loop, not a redirect. */
const MAXIMUM_REDIRECTS = 4;

/** Cap on any single response, well above the ~400 kB a large table takes. */
const MAXIMUM_RESPONSE_BYTES = 16 * 1024 * 1024;

/** The columns of a row, declared once for the file rather than per table. */
const COLUMNS = [
  'division',
  'weightClass',
  'lift',
  'holder',
  'kilograms',
  'pounds',
  'date',
] as const;

interface CrawledTable {
  readonly target: RecordTableTarget;
  readonly title: string;
  readonly rows: readonly RawRecordRow[];
  readonly anomalies: readonly RecordTableAnomaly[];
}

interface AbsentTable {
  readonly target: RecordTableTarget;
  readonly reason: string;
}

async function main(): Promise<void> {
  const limit = readLimit();
  const outputPath = readOutputPath();
  const tableUrl = await readTableUrlTemplate();

  console.log('Walking the record index...');
  const targets = await collectTargets();
  console.log(`Found ${String(targets.length)} record tables.`);

  const wanted = limit === null ? targets : targets.slice(0, limit);
  if (wanted.length < targets.length) {
    // Said out loud, and written into the snapshot below. A partial crawl that
    // looked complete would publish empty categories as though the federation
    // had no records in them.
    console.log(
      `--limit ${String(limit)}: reading ${String(wanted.length)} of them and skipping ` +
        `${String(targets.length - wanted.length)}.`,
    );
  }

  const tables: CrawledTable[] = [];
  const absent: AbsentTable[] = [];
  let done = 0;

  await inParallel(wanted, CONCURRENCY, async (target) => {
    try {
      tables.push(await readTable(target, tableUrl));
    } catch (error) {
      absent.push({ target, reason: describe(error) });
    }
    done += 1;
    if (done % 50 === 0 || done === wanted.length) {
      console.log(`  ${String(done)}/${String(wanted.length)} tables`);
    }
  });

  // Sorted, because `inParallel` finishes in whatever order the network allows
  // and a snapshot whose order moves between runs is a snapshot whose every diff
  // is unreadable.
  tables.sort((left, right) => (targetKey(left.target) < targetKey(right.target) ? -1 : 1));
  absent.sort((left, right) => (targetKey(left.target) < targetKey(right.target) ? -1 : 1));

  assertOneTablePerName(tables);

  const rowCount = tables.reduce((total, table) => total + table.rows.length, 0);
  const anomalies = tables.flatMap((table) =>
    table.anomalies.map((anomaly) => ({ table: targetKey(table.target), ...anomaly })),
  );

  await write(outputPath, {
    partial: wanted.length < targets.length,
    tables,
    absent,
    anomalies,
  });

  console.log(
    `\nWrote ${outputPath}: ${String(rowCount)} records in ${String(tables.length)} tables, ` +
      `${String(absent.length)} tables unavailable, ${String(anomalies.length)} anomalies.`,
  );
  for (const entry of absent) {
    console.log(`  unavailable  ${targetKey(entry.target)} -- ${entry.reason}`);
  }
  for (const anomaly of anomalies) {
    console.log(`  anomaly      ${anomaly.table}  ${anomaly.path} -- ${anomaly.reason}`);
  }
}

/**
 * Walks the index for every table the site links to.
 *
 * Two levels, because that is what the site has: the index links to a level and
 * a drug-tested status, and a level either lists its regions or goes straight to
 * its tables. Neither the levels nor the regions are written down here -- a
 * federation that adds a state should be crawled for it without a code change,
 * and a hard-coded list is a list that goes stale silently.
 */
async function collectTargets(): Promise<readonly RecordTableTarget[]> {
  const found = new Map<string, RecordTableTarget>();
  const visited = new Set<string>();

  const index = await fetchText(INDEX_URL);
  const queue = [...readAreaTargets(index)];

  while (queue.length > 0) {
    const area = queue.shift();
    if (area === undefined) {
      break;
    }
    const key = `${area.location}/${area.status}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    const html = await fetchText(
      `https://records.uspa.net/area.php?location=${area.location}&status=${area.status}`,
    );
    for (const target of readTableTargets(html)) {
      found.set(targetKey(target), target);
    }
    for (const nested of readAreaTargets(html)) {
      queue.push(nested);
    }
  }

  return [...found.values()].sort((left, right) => (targetKey(left) < targetKey(right) ? -1 : 1));
}

/**
 * The template every table's address is built from.
 *
 * A crawl with no template is refused rather than run, because the alternative is
 * a full crawl -- minutes of somebody else's bandwidth -- discarded at the end,
 * or worse, a corpus published with no way back to the source.
 *
 * @throws {Error} if the mapping cannot be read or names no template.
 */
async function readTableUrlTemplate(): Promise<string> {
  const path = resolve(DEFAULT_MAPPING);
  const references = readRecordSourceReferences(JSON.parse(await readFile(path, 'utf8')));
  if (references.tableUrl === null) {
    throw new Error(
      `${DEFAULT_MAPPING} sets "tableUrl" to null, and this crawler reads its tables by URL. ` +
        'Set the template, or crawl a source that has one.',
    );
  }
  return references.tableUrl;
}

/** The three requests that turn one link into one table. */
async function readTable(target: RecordTableTarget, tableUrl: string): Promise<CrawledTable> {
  const page = await fetchText(buildRecordTableUrl(tableUrl, target));
  const loader = await fetchText(embedQueryUrl(readEmbedQuery(page)));
  const document = await fetchText(componentDocumentUrl(readEmbedComponent(loader)));
  const table = readRecordTable(decodeTableDocument(JSON.parse(document) as unknown));
  return { target, ...table };
}

/**
 * Refuses a crawl in which two links resolved to the same table.
 *
 * The strongest check available without knowing the federation's vocabulary. The
 * failure it catches is a stale identifier on a record page, which would file
 * one region's records under another region's name -- plausible figures, in the
 * wrong place, with nothing on screen to say so.
 */
function assertOneTablePerName(tables: readonly CrawledTable[]): void {
  const byTitle = new Map<string, string[]>();
  for (const table of tables) {
    byTitle.set(table.title, [...(byTitle.get(table.title) ?? []), targetKey(table.target)]);
  }

  const shared = [...byTitle.entries()].filter(([, targets]) => targets.length > 1);
  if (shared.length > 0) {
    throw new Error(
      `${String(shared.length)} table(s) were reached by more than one link, so at least one ` +
        'link resolves to the wrong records:\n  ' +
        shared.map(([title, targets]) => `${title} <- ${targets.join(', ')}`).join('\n  '),
    );
  }
}

interface Snapshot {
  readonly partial: boolean;
  readonly tables: readonly CrawledTable[];
  readonly absent: readonly AbsentTable[];
  readonly anomalies: readonly (RecordTableAnomaly & { table: string })[];
}

/**
 * Writes the snapshot with one record to a line.
 *
 * Hand-serialised rather than `JSON.stringify(value, null, 2)`, which would put
 * every field of every record on its own line and turn a file of a few hundred
 * thousand records into a file of a few million lines. One line per record keeps
 * a week's diff to the handful of records that actually changed, which is the
 * only way anybody reviews a refresh.
 *
 * Rows are arrays against the `columns` header for the same reason -- repeating
 * seven field names per record is most of the file.
 */
async function write(path: string, snapshot: Snapshot): Promise<void> {
  const lines: string[] = [
    '{',
    `  "$comment": ${JSON.stringify(COMMENT)},`,
    `  "partial": ${String(snapshot.partial)},`,
    `  "columns": ${JSON.stringify(COLUMNS)},`,
    '  "tables": [',
  ];

  snapshot.tables.forEach((table, index) => {
    lines.push('    {');
    lines.push(`      "location": ${JSON.stringify(table.target.location)},`);
    lines.push(`      "status": ${JSON.stringify(table.target.status)},`);
    lines.push(`      "event": ${JSON.stringify(table.target.event)},`);
    lines.push(`      "title": ${JSON.stringify(table.title)},`);
    if (table.rows.length === 0) {
      lines.push('      "rows": []');
    } else {
      lines.push('      "rows": [');
      table.rows.forEach((row, rowIndex) => {
        const cells = COLUMNS.map((column) => JSON.stringify(row[column]));
        lines.push(`        [${cells.join(', ')}]${rowIndex === table.rows.length - 1 ? '' : ','}`);
      });
      lines.push('      ]');
    }
    lines.push(`    }${index === snapshot.tables.length - 1 ? '' : ','}`);
  });

  lines.push('  ],');
  lines.push(`  "absent": ${JSON.stringify(snapshot.absent, null, 2).replaceAll('\n', '\n  ')},`);
  lines.push(
    `  "anomalies": ${JSON.stringify(snapshot.anomalies, null, 2).replaceAll('\n', '\n  ')}`,
  );
  lines.push('}');

  const full = resolve(process.cwd(), path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, `${lines.join('\n')}\n`, 'utf8');
}

const COMMENT = [
  'USPA record tables, exactly as the federation publishes them.',
  '',
  'Written by `pnpm run data:crawl:records`. Nothing in this file is interpreted:',
  'the divisions, weight classes and lifts are the strings the source uses, and',
  '`data/sources/records/uspa.json` says what each one means. Edit that file, not',
  'this one -- a hand-edit here is lost on the next refresh.',
  '',
  'Records change after every meet, so unlike the classification snapshot this one',
  'is not pinned to a digest. A pin that had to be re-cut weekly would stop being a',
  'decision anybody made and start being a step in a script.',
];

/**
 * Fetches a URL, checking the allowlist at every hop.
 *
 * Redirects are followed by hand. `fetch` will follow them itself, but it checks
 * nothing: the allowlist would then apply to the first address only, and one of
 * these requests is a redirect to a second vendor host by design. Following them
 * here means every host in the chain had to be permitted in `fetch-policy`.
 */
async function fetchText(url: string): Promise<string> {
  let target = url;

  for (let hop = 0; hop <= MAXIMUM_REDIRECTS; hop++) {
    assertAllowedSourceUrl(target);
    const response = await withRetries(target, () =>
      fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
        headers: { accept: 'text/html, application/json, text/plain;q=0.5, */*;q=0.1' },
      }),
    );

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null || location === '') {
        throw new Error(`answered ${String(response.status)} with no location`);
      }
      // Resolved against the current address so a relative redirect works, then
      // checked at the top of the next turn of this loop.
      target = new URL(location, target).href;
      continue;
    }

    if (!response.ok) {
      throw new Error(`answered ${String(response.status)}`);
    }
    return await readBody(response);
  }

  throw new Error(`redirected more than ${String(MAXIMUM_REDIRECTS)} times`);
}

/**
 * Retries a request a few times, and never says which URL failed.
 *
 * `fetch` puts the address into several of its messages. The caller already
 * knows which table it asked for and reports that; a URL in the text would put
 * a full address into a log for no benefit, which is the habit section 2.3 is
 * about.
 */
async function withRetries(url: string, attempt: () => Promise<Response>): Promise<Response> {
  let last: unknown;
  for (let tries = 0; tries < ATTEMPTS; tries++) {
    if (tries > 0) {
      await sleep(RETRY_DELAY_MS * tries);
    }
    try {
      const response = await attempt();
      // A 5xx is worth another try; a 4xx is an answer and will not change.
      if (response.status >= 500) {
        last = new Error(`answered ${String(response.status)}`);
        continue;
      }
      return response;
    } catch (error) {
      last = new Error(redact(error, url));
    }
  }
  throw last instanceof Error ? last : new Error('could not be fetched');
}

/** Reads a response body, counted rather than trusted. */
async function readBody(response: Response): Promise<string> {
  if (response.body === null) {
    throw new Error('answered with an empty body');
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of response.body) {
    const bytes = chunk as Uint8Array;
    received += bytes.byteLength;
    if (received > MAXIMUM_RESPONSE_BYTES) {
      throw new Error(`answered with more than ${String(MAXIMUM_RESPONSE_BYTES)} bytes`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Runs a bounded number of tasks at a time, in order, to completion. */
async function inParallel<TItem>(
  items: readonly TItem[],
  limit: number,
  run: (item: TItem) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) {
        await run(item);
      }
    }
  });
  await Promise.all(workers);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redact(error: unknown, url: string): string {
  return describe(error).split(url).join('<url>');
}

function readOutputPath(): string {
  const index = process.argv.indexOf('--out');
  if (index === -1) {
    return DEFAULT_OUTPUT;
  }
  const supplied = process.argv[index + 1];
  if (supplied === undefined || supplied.startsWith('--')) {
    throw new Error('--out needs a path after it.');
  }
  return supplied;
}

function readLimit(): number | null {
  const index = process.argv.indexOf('--limit');
  if (index === -1) {
    return null;
  }
  const supplied = Number(process.argv[index + 1]);
  if (!Number.isInteger(supplied) || supplied < 1) {
    throw new Error('--limit needs a positive whole number after it.');
  }
  return supplied;
}

await main();
