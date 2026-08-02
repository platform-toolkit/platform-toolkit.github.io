/**
 * Reading USPA's published record tables.
 *
 * The federation's record index is a small PHP site whose every table is drawn
 * by a third-party embed. Following it takes three steps, and each one is a
 * parser in this file:
 *
 *   1. A record page carries a `<script src>` for the embed vendor, with the
 *      identifiers of the table in its query string.
 *   2. The vendor answers that with a one-line loader that names the document.
 *   3. The document is a public database record holding the whole table as a
 *      base64 ZIP.
 *
 * No browser is involved, which is worth saying because the obvious way to read
 * a page whose content arrives from an embed is to render it headlessly and
 * scrape the result. That was the first plan. It is three thousand page loads a
 * refresh, each starting a database client and holding a streaming channel open
 * that never goes idle, and every one of them is a chance for a timing flake in
 * an unattended job. Three plain requests are faster, deterministic, and go
 * through `assertAllowedSourceUrl` like every other fetch in this package --
 * a headless page load does not, because the requests it makes are the page's.
 *
 * Everything here is pure. The bin does the fetching, the retrying and the
 * ordering; what lives in this file is what can be tested without a network.
 *
 * ON TRUST. Each of these functions reads bytes from a host this project does not
 * control, so each one validates rather than extracts. Identifiers are matched
 * against a shape and refused if they do not fit; nothing read from a page is
 * ever used as a host, a path, or a file name. In particular the embed URL is
 * rebuilt from three named parameters rather than taken from the page, so a
 * record page that started serving a different `src` cannot redirect this
 * crawler anywhere.
 *
 * ON PRIVACY. A record names the lifter who set it. Under section 2.3 that name
 * stays out of logs and error text, so every failure in this file is reported by
 * position -- division, class, lift -- and never by value.
 */
import * as v from 'valibot';

import { readSingleZipEntry } from '../zip-entry.js';

/**
 * The database project the embed reads from.
 *
 * Hard-coded, and it is the one thing here that is. It could be recovered from
 * the embed's script bundle on every run, which would mean parsing minified
 * JavaScript to avoid writing down a constant that has to change on purpose.
 * Written down, a change upstream is an immediate and total failure with a clear
 * message; recovered, it is a parser that silently finds nothing.
 */
const EMBED_PROJECT = 'infoweave-13b9d';

/** Where a record page's embed script points. Rebuilt, never copied. */
const EMBED_QUERY_ORIGIN = 'https://app.infoweave.io';
const EMBED_QUERY_PATH = '/embed/uspa/ais/public/records/queryget';

/** The database's public read API. */
const DOCUMENT_ORIGIN = 'https://firestore.googleapis.com';

/**
 * The three identifiers that name a table, in the order they are sent.
 *
 * Fixed order because the request is rebuilt from a map rather than passed
 * through, and a crawler whose URLs vary run to run defeats every cache between
 * here and the origin.
 */
const EMBED_PARAMETERS = [
  'hierarchy_category_id',
  'hierarchy_item_id',
  'sub_hierarchy_item_id',
] as const;

/**
 * A slug in one of the site's own URLs.
 *
 * Lowercase, digits and single hyphens. Every location, status and event the
 * site publishes fits, and anything that does not is a link this crawler has
 * misread rather than a page it should fetch.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAXIMUM_SLUG_LENGTH = 64;

/** A database document identifier, as the vendor's URLs spell them. */
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Cap on a decoded table.
 *
 * The largest measured is about 390 kB. Eight mebibytes is room for a federation
 * doubling its published records twice over, and small enough that a vendor
 * serving something unexpected is a failed crawl rather than a memory problem.
 */
export const MAXIMUM_TABLE_BYTES = 8 * 1024 * 1024;

/** The names the embed gives the four fields of a record. */
const HOLDER_FIELD = 'name';
const KILOGRAMS_FIELD = 'kgs';
const POUNDS_FIELD = 'lbs';
const DATE_FIELD = 'date';

export class RecordCrawlError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RecordCrawlError';
  }
}

/** One record table, named the way the site's own links name it. */
export interface RecordTableTarget {
  readonly location: string;
  readonly status: string;
  readonly event: string;
}

/** The three identifiers that reach one table's embed. */
export type EmbedQuery = Readonly<Record<(typeof EMBED_PARAMETERS)[number], string>>;

/** The document the embed loads, as three path segments. */
export interface EmbedComponent {
  readonly app: string;
  readonly instance: string;
  readonly component: string;
}

/** One published record, in the federation's own words. */
export interface RawRecordRow {
  readonly division: string;
  readonly weightClass: string;
  readonly lift: string;
  readonly holder: string;
  readonly kilograms: string;
  readonly pounds: string;
  readonly date: string;
}

/** A cell the crawler could not read, named by position and never by value. */
export interface RecordTableAnomaly {
  readonly path: string;
  readonly reason: string;
}

/** One table, read. */
export interface RawRecordTable {
  /**
   * The table's own title, such as `State/Drug Tested Records/Iowa/Raw/...`.
   *
   * Carried verbatim and not interpreted here. It is the only thing the document
   * says about which table it is, which makes it the one cross-check available
   * against the identifiers that were used to reach it -- and interpreting it
   * means knowing the federation's vocabulary, which is the mapping's job.
   */
  readonly title: string;
  readonly rows: readonly RawRecordRow[];
  readonly anomalies: readonly RecordTableAnomaly[];
}

/**
 * Pulls `location` and `status` out of every area link on a page.
 *
 * Used on the site's index, whose links are the levels, and then on a level's
 * page, whose links are the regions within it. The same function reads both
 * because the site uses one link shape for both, and a crawler that hard-coded
 * the levels would not notice the day a fourth one is added.
 */
export function readAreaTargets(html: string): readonly { location: string; status: string }[] {
  const found: { location: string; status: string }[] = [];
  const seen = new Set<string>();
  const pattern = /\/area\.php\?location=([^"'&\s]+)&(?:amp;)?status=([^"'&\s]+)/g;

  for (const match of html.matchAll(pattern)) {
    const location = requireSlug(match[1] ?? '', 'location');
    const status = requireSlug(match[2] ?? '', 'status');
    const key = `${location}/${status}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push({ location, status });
    }
  }
  return found;
}

/**
 * Pulls every record table link out of an area page.
 *
 * Deduplicated, because the same link can appear in a heading and a button, and
 * a target crawled twice is a table published twice under one name.
 */
export function readTableTargets(html: string): readonly RecordTableTarget[] {
  const found: RecordTableTarget[] = [];
  const seen = new Set<string>();
  const pattern =
    /\/records\.php\?location=([^"'&\s]+)&(?:amp;)?status=([^"'&\s]+)&(?:amp;)?event=([^"'&\s]+)/g;

  for (const match of html.matchAll(pattern)) {
    const target: RecordTableTarget = {
      location: requireSlug(match[1] ?? '', 'location'),
      status: requireSlug(match[2] ?? '', 'status'),
      event: requireSlug(match[3] ?? '', 'event'),
    };
    const key = targetKey(target);
    if (!seen.has(key)) {
      seen.add(key);
      found.push(target);
    }
  }
  return found;
}

/** How a target is spelled in a message or used as a map key. */
export function targetKey(target: RecordTableTarget): string {
  return `${target.location}/${target.status}/${target.event}`;
}

/**
 * Reads the three table identifiers out of a record page's embed script.
 *
 * Only the parameters are taken. The host and the path in the page's `src` are
 * ignored and the request is rebuilt from `EMBED_QUERY_ORIGIN` below, so the
 * worst a modified record page can do is name a table that does not exist.
 * Copying the `src` would turn every page on the site into a URL this project
 * fetches, which is the exact thing the source allowlist exists to prevent.
 */
export function readEmbedQuery(html: string): EmbedQuery {
  const match = /queryget\?([^"'<>\s]+)/.exec(html);
  if (match === null) {
    throw new RecordCrawlError('The page carries no record embed.');
  }

  const parameters = new URLSearchParams((match[1] ?? '').replaceAll('&amp;', '&'));
  const query: Record<string, string> = {};
  for (const name of EMBED_PARAMETERS) {
    const value = parameters.get(name);
    if (value === null || !/^\d{1,12}$/.test(value)) {
      throw new RecordCrawlError(`The record embed does not carry a numeric "${name}".`);
    }
    query[name] = value;
  }
  return query as EmbedQuery;
}

/** The embed request for one table, built from parameters this file validated. */
export function embedQueryUrl(query: EmbedQuery): string {
  const parameters = new URLSearchParams();
  for (const name of EMBED_PARAMETERS) {
    parameters.set(name, query[name]);
  }
  return `${EMBED_QUERY_ORIGIN}${EMBED_QUERY_PATH}?${parameters.toString()}`;
}

/**
 * Reads the document identifiers out of the embed's loader.
 *
 * The loader is one line of JavaScript that writes an iframe. Only the three
 * path segments of its `src` are taken, each validated against the shape of a
 * document identifier, and the address they are used to build is assembled from
 * `DOCUMENT_ORIGIN` -- the loader's own origin is never fetched.
 */
export function readEmbedComponent(loader: string): EmbedComponent {
  const match = /\/embed\/([^/"'\s]+)\/([^/"'\s]+)\/([^/"'?\s]+)/.exec(loader);
  if (match === null) {
    throw new RecordCrawlError('The embed loader names no document.');
  }
  return {
    app: requireDocumentId(match[1] ?? '', 'app'),
    instance: requireDocumentId(match[2] ?? '', 'instance'),
    component: requireDocumentId(match[3] ?? '', 'component'),
  };
}

/** Where a table's document is read from. */
export function componentDocumentUrl(component: EmbedComponent): string {
  return (
    `${DOCUMENT_ORIGIN}/v1/projects/${EMBED_PROJECT}/databases/(default)/documents/` +
    `apps/${component.app}/instances/${component.instance}/components/${component.component}`
  );
}

/**
 * The document as the database returns it.
 *
 * Only the two fields this crawler reads are described. The rest -- timestamps
 * whose meaning is the vendor's, an internal name -- are left unread rather than
 * modelled, because a schema that describes fields nobody uses is a schema that
 * fails a build over a field nobody would have missed.
 */
const ComponentDocumentSchema = v.object({
  fields: v.object({
    zipped: v.optional(v.object({ booleanValue: v.boolean() })),
    definition: v.object({ stringValue: v.string() }),
  }),
});

/** A node of the table tree: either a branch with children or a leaf with a value. */
interface DefinitionNode {
  readonly name?: string | undefined;
  readonly value?: string | null | undefined;
  readonly type?: string | undefined;
  readonly items?: readonly DefinitionNode[] | undefined;
}

/**
 * `value` is nullable because the source spells an empty cell three ways.
 *
 * A lift nobody has set a record in comes back with the field absent, or with
 * `"value": null`, or with `"value": ""`, and which one depends on nothing this
 * project can see. The first crawl of the real site refused a third of the
 * tables over this -- and refused them as "not the shape this crawler reads",
 * which is the right message for a source that changed shape and the wrong one
 * for a source that was always like this. `isFilled` below is the single place
 * the three spellings become one meaning; do not test `!== undefined` anywhere
 * else, or a record gets filed with a holder of `null`.
 */
const DefinitionNodeSchema: v.GenericSchema<unknown, DefinitionNode> = v.lazy(() =>
  v.object({
    name: v.optional(v.string()),
    value: v.optional(v.nullable(v.string())),
    type: v.optional(v.string()),
    items: v.optional(v.array(DefinitionNodeSchema)),
  }),
);

const DefinitionSchema = v.object({
  name: v.string(),
  items: v.array(DefinitionNodeSchema),
});

/**
 * Turns the document the database serves into the tree it encodes.
 *
 * The payload is base64 of a ZIP of one JSON file, and `zipped` says so. The
 * flag is honoured rather than sniffed: a document that stops being compressed
 * is a change this should follow, and a reader that guesses from the first bytes
 * would also "follow" a corrupted one.
 */
export function decodeTableDocument(document: unknown): unknown {
  const parsed = v.safeParse(ComponentDocumentSchema, document);
  if (!parsed.success) {
    throw new RecordCrawlError(
      `The table document is not the shape this crawler reads: ${describeIssues(parsed.issues)}`,
    );
  }

  const encoded = parsed.output.fields.definition.stringValue;
  if (parsed.output.fields.zipped?.booleanValue !== true) {
    return parseJson(encoded);
  }

  // `base64` is Node's forgiving decoder: it drops anything outside the alphabet
  // rather than failing. That is fine here only because what comes out is then
  // read as an archive, which checks its own structure and its own checksum.
  const archive = Buffer.from(encoded, 'base64');
  const entry = readSingleZipEntry(archive, MAXIMUM_TABLE_BYTES);
  return parseJson(entry.bytes.toString('utf8'));
}

/**
 * Reads one table out of a decoded tree.
 *
 * The tree is four deep: division, weight class, lift, field. That depth is
 * asserted rather than assumed -- a leaf at the wrong depth becomes an anomaly
 * naming its path, because the alternative is a silently shorter table, and a
 * record table that is missing rows looks exactly like a category in which
 * nobody has set a record.
 *
 * A lift with no values at all is not an anomaly. It is the normal case: most
 * combinations of division and weight class have no record in most states.
 */
export function readRecordTable(tree: unknown): RawRecordTable {
  const parsed = v.safeParse(DefinitionSchema, tree);
  if (!parsed.success) {
    throw new RecordCrawlError(
      `The table is not the shape this crawler reads: ${describeIssues(parsed.issues)}`,
    );
  }

  const hierarchies = parsed.output.items.filter((item) => item.type === 'hierarchy');
  const hierarchy = hierarchies[0];
  if (hierarchies.length !== 1 || hierarchy === undefined) {
    throw new RecordCrawlError(
      `Expected one hierarchy in the table, found ${String(hierarchies.length)}.`,
    );
  }

  const rows: RawRecordRow[] = [];
  const anomalies: RecordTableAnomaly[] = [];

  for (const division of hierarchy.items ?? []) {
    for (const weightClass of division.items ?? []) {
      for (const lift of weightClass.items ?? []) {
        const path = [division.name, weightClass.name, lift.name];
        readLift({ lift, path, rows, anomalies });
      }
    }
  }

  return { title: parsed.output.name, rows, anomalies };
}

interface LiftRequest {
  readonly lift: DefinitionNode;
  readonly path: readonly (string | undefined)[];
  readonly rows: RawRecordRow[];
  readonly anomalies: RecordTableAnomaly[];
}

function readLift(request: LiftRequest): void {
  const { lift, path, rows, anomalies } = request;
  const where = path.map((segment) => segment ?? '?').join(' / ');

  if (path.some((segment) => segment === undefined || segment === '')) {
    anomalies.push({ path: where, reason: 'A level of the table has no name.' });
    return;
  }

  const fields = new Map<string, string>();
  for (const field of lift.items ?? []) {
    if (field.items !== undefined) {
      anomalies.push({ path: where, reason: 'A record has a level below it that was not read.' });
      return;
    }
    if (field.name !== undefined && isFilled(field.value)) {
      fields.set(field.name, field.value);
    }
  }

  if (fields.size === 0) {
    return;
  }

  const holder = fields.get(HOLDER_FIELD);
  const kilograms = fields.get(KILOGRAMS_FIELD);
  const pounds = fields.get(POUNDS_FIELD);
  const date = fields.get(DATE_FIELD);
  if (
    holder === undefined ||
    kilograms === undefined ||
    pounds === undefined ||
    date === undefined
  ) {
    // Reported, not dropped and not repaired. A record with a weight and no date
    // is still a fact about somebody's lift, and inventing the missing half is
    // worse than saying which position is short. Only the field names are named.
    anomalies.push({
      path: where,
      reason: `A record is missing ${missingFields(fields).join(', ')}.`,
    });
    return;
  }

  // `path` was checked above, so the three levels are present strings.
  rows.push({
    division: path[0] ?? '',
    weightClass: path[1] ?? '',
    lift: path[2] ?? '',
    holder,
    kilograms,
    pounds,
    date,
  });
}

/** Whether a cell holds anything, across all three spellings of "it does not". */
function isFilled(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== '';
}

function missingFields(fields: ReadonlyMap<string, string>): readonly string[] {
  return [HOLDER_FIELD, KILOGRAMS_FIELD, POUNDS_FIELD, DATE_FIELD].filter(
    (name) => !fields.has(name),
  );
}

function requireSlug(value: string, what: string): string {
  const decoded = decodeURIComponent(value);
  if (decoded.length > MAXIMUM_SLUG_LENGTH || !SLUG.test(decoded)) {
    throw new RecordCrawlError(`Not a usable ${what} in a site link: ${JSON.stringify(value)}`);
  }
  return decoded;
}

function requireDocumentId(value: string, what: string): string {
  if (!DOCUMENT_ID.test(value)) {
    throw new RecordCrawlError(`Not a usable ${what} identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new RecordCrawlError('The table document does not hold JSON.', { cause });
  }
}

/**
 * How many failing positions a message names before it stops.
 *
 * Small, because these payloads are thousands of leaves deep and a shape change
 * affects every leaf of a kind at once. Uncapped, the first crawl of the real
 * site put thirty kilobytes of near-identical text into one line of the log,
 * three hundred times -- which is not a longer diagnosis than five paths, it is
 * a shorter one that nobody can find. The count that follows is what says
 * whether this is one odd cell or the whole table.
 */
const ISSUES_NAMED = 5;

/**
 * Says where a document failed to validate, and never what it held.
 *
 * The path is the diagnosis -- it points at the field whose shape changed. The
 * value is the part that might be somebody's name.
 */
function describeIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  const described = issues.slice(0, ISSUES_NAMED).map((issue) => {
    const path = (issue.path ?? []).map((entry) => String(entry.key)).join('.');
    return `${path === '' ? '(root)' : path} expected ${issue.expected ?? 'something else'}`;
  });

  const rest = issues.length - described.length;
  return rest > 0 ? `${described.join('; ')} (and ${String(rest)} more)` : described.join('; ');
}
