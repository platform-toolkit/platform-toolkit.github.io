import {
  LiftSchema,
  RecordBookSchema,
  SexCategorySchema,
  type CategoryCatalog,
  type FederationRecord,
  type Lift,
  type RecordBook,
  type RecordSourceTable,
  type SourceFreshness,
} from '@platform-toolkit/data-contracts';
import { formatPlainDate, parseKilograms, parsePlainDate } from '@platform-toolkit/domain';
import * as v from 'valibot';

import { RecordTableUrlTemplateSchema, buildRecordTableUrl } from './record-tables.js';

/**
 * Turning a federation's published record tables into one record book.
 *
 * The tables are crawled, not transcribed: `crawl-records` writes them into a
 * snapshot in the federation's own words, and a curated document beside it says
 * what those words mean. Nothing in this file names a federation, and nothing in
 * it knows that `OPEN MEN` is the open division for men. That is data, and it
 * lives in `data/sources/records/`.
 *
 * THE DIFFERENCE FROM THE CLASSIFICATION STANDARDS
 *
 * That dataset is a fixed table somebody re-exports by hand, and it is pinned to
 * a digest so that a change upstream cannot arrive unreviewed. These tables
 * change after every meet weekend and refresh with nobody watching, so a digest
 * would either be re-cut by a script -- which is not a review -- or stop the
 * refresh dead. Everything the digest buys there is bought here by checks about
 * meaning rather than bytes: every value the tables use has to be mapped, every
 * mapping has to be used, and every table's own heading has to agree with the
 * three identifiers that reached it.
 *
 * For the same reason, rows are excluded by **rule** and never by a list. A
 * quarantine list goes stale between Sunday and Monday, and the refresh then
 * fails on a row nobody has had a chance to look at. What guards against a rule
 * quietly swallowing the corpus is a budget: the mapping declares how many rows
 * may be excluded, and a parser regression that suddenly drops thousands is a
 * failed build rather than a successful one publishing a fraction of the
 * records.
 *
 * WHAT NO MESSAGE IN THIS FILE MAY CONTAIN
 *
 * A record holder's name. It belongs beside their lift on screen and nowhere
 * near a CI log (section 2.3), so every problem and every withheld row names a
 * position -- table, division, class, lift -- and never a person.
 */

const NonEmpty = v.pipe(v.string(), v.minLength(1));

/**
 * How many of one kind of problem are printed before the rest are counted.
 *
 * A mapping mistake is rarely singular: one wrong division column is a thousand
 * rows, and a heading format that changed is a thousand tables. Printing all of
 * them buries every *other* problem in the same run, which is the thing the
 * report-everything-at-once rule exists to prevent.
 */
const MAXIMUM_REPORTED = 20;

/** The columns of a snapshot row, in the order the crawler writes them. */
const SNAPSHOT_COLUMNS = [
  'division',
  'weightClass',
  'lift',
  'holder',
  'kilograms',
  'pounds',
  'date',
] as const;

/** Where a published dataset came from and when. */
const ProvenanceSchema = v.object({
  id: NonEmpty,
  label: NonEmpty,
  document: NonEmpty,
  url: v.pipe(v.string(), v.url()),
  sections: v.pipe(v.array(NonEmpty), v.minLength(1)),
  retrievedAt: v.pipe(v.string(), v.isoTimestamp()),
});

/**
 * The committed crawl, and where it came from.
 *
 * A plain filename, not a path: the caller resolves it inside the snapshot
 * directory, and a name that could climb out of one never reaches that code.
 *
 * There is deliberately no digest here. See the header.
 */
const SnapshotReferenceSchema = v.object({
  // `check` rather than `regex`, because valibot reports the pattern itself as
  // the expectation and these messages are read by somebody editing the file.
  file: v.pipe(
    v.string(),
    v.check((value) => /^[a-z0-9][a-z0-9._-]*\.json$/u.test(value), 'a plain JSON filename'),
  ),

  /** Where the crawl starts, or `null`. Recorded for a reader, never fetched here. */
  url: v.nullable(
    v.pipe(
      v.string(),
      v.url(),
      v.check((value) => value.startsWith('https://'), 'an https URL'),
      v.check((value) => {
        const parsed = URL.parse(value);
        return parsed !== null && parsed.username === '' && parsed.password === '';
      }, 'a URL with no embedded credentials'),
    ),
  ),
});

/**
 * One link on the records site, and the level and region it stands for.
 *
 * The two `title` fields are the segments the table's own heading uses. They are
 * the only cross-check available against the identifiers that reached the table,
 * so a stale link filing one region's records under another's is a failed build
 * rather than plausible figures in the wrong place.
 */
const LocationMappingSchema = v.object({
  location: NonEmpty,
  levelId: NonEmpty,
  /** `null` for a level the catalogue does not subdivide. Never "all regions". */
  regionId: v.nullable(NonEmpty),
  titleLevel: NonEmpty,
  titleRegion: v.nullable(NonEmpty),
});

/** One published book -- drug tested or not -- and the heading it prints. */
const StatusMappingSchema = v.object({
  status: NonEmpty,
  tested: v.boolean(),
  titleStatus: NonEmpty,
});

/**
 * One published event: a discipline in an equipment category.
 *
 * `equipmentId` is mapped from the event and never read from `titleGear`, which
 * a federation may well print as `Raw` for a classic raw book.
 */
const EventMappingSchema = v.object({
  event: NonEmpty,
  disciplineId: NonEmpty,
  equipmentId: NonEmpty,
  titleGear: NonEmpty,
  titleEvent: NonEmpty,
});

const LiftMappingSchema = v.object({ column: NonEmpty, lift: LiftSchema });

/** One division column. The sex is read from it, because it is printed in it. */
const DivisionMappingSchema = v.object({
  column: NonEmpty,
  sex: SexCategorySchema,
  divisionId: NonEmpty,
});

/** Keyed by sex as well as by column, because two ladders can share a number. */
const WeightClassMappingSchema = v.object({
  sex: SexCategorySchema,
  column: NonEmpty,
  weightClassId: NonEmpty,
});

/** A published column the rulebook's ladder for that sex does not contain. */
const UnmappedWeightClassSchema = v.object({
  sex: SexCategorySchema,
  column: NonEmpty,
  reason: NonEmpty,
});

/** A place the site links to and the table service does not answer for. */
const AbsentLocationSchema = v.object({ location: NonEmpty, reason: NonEmpty });

/**
 * A holder cell that names no lifter.
 *
 * A federation founding a record book seeds every category with a figure to
 * beat, and writes something in the holder column to say so. The wording is the
 * federation's own -- and so is the founding date it stamps the row with, which
 * is not a date any lift was made.
 *
 * Curated data rather than a constant in this file for the reason §5.1 gives:
 * the day the federation changes the wording, the fix is a mapping edit and a
 * refresh, not a release. Matched case-insensitively on the whitespace-collapsed
 * cell, because the tables are hand-maintained and "Record preset" appearing
 * next year would otherwise become a lifter with a very large number of records.
 */
const PlaceholderHolderSchema = v.object({ holder: NonEmpty, reason: NonEmpty });

/**
 * The band a published figure has to fall in, and how many rows may fail it.
 *
 * Wide on purpose: this is about a column having moved or a decimal point having
 * been lost, not about whether a lift is impressive. The budget is the part that
 * earns its keep -- see the header.
 */
const PlausibilitySchema = v.object({
  minimumKilograms: v.pipe(v.number(), v.finite(), v.minValue(0)),
  maximumSingleLiftKilograms: v.pipe(v.number(), v.finite(), v.minValue(0)),
  maximumTotalKilograms: v.pipe(v.number(), v.finite(), v.minValue(0)),
  maximumExcludedRows: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

/**
 * The curated form of one federation's record mapping.
 *
 * `$comment` keys are tolerated anywhere they appear and dropped rather than
 * published: JSON has no comments, and a mapping that cannot explain itself is a
 * mapping nobody dares change.
 */
export const RecordSourceDocumentSchema = v.object({
  id: NonEmpty,
  label: NonEmpty,
  provenance: ProvenanceSchema,
  snapshot: SnapshotReferenceSchema,

  /**
   * The book's label and the margins a lift must beat a record by.
   *
   * No identifier: the book is the federation's, and `id` above is its name. A
   * second name chosen here would be a second thing to keep in step, and its
   * failure is a lookup that finds nothing -- which the screen renders as "no
   * records in this category", a real answer nobody would investigate.
   *
   * The three margin fields are the federation's own rules and are curated
   * rather than assumed, for the reason the contract gives: a lifter told to put
   * more on the bar than the rulebook demands loses an attempt, and one told to
   * put less on loses the record.
   */
  book: v.object({
    label: NonEmpty,
    minimumIncrementKilograms: v.pipe(v.number(), v.finite(), v.minValue(0)),
    higherSanctionIncrementKilograms: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),
    matchTakesUnclaimedLevelIds: v.array(NonEmpty),
  }),

  /**
   * Where one published table can be read, with `{location}`, `{status}` and
   * `{event}` standing in for the three identifiers that name it.
   *
   * `null` for a source whose tables have no address of their own -- a PDF, or a
   * page that posts a form. Records from such a source are shown without a link,
   * which is the honest outcome; a guessed one would send a lifter to somebody
   * else's records.
   */
  tableUrl: v.nullable(RecordTableUrlTemplateSchema),

  locations: v.pipe(v.array(LocationMappingSchema), v.minLength(1)),
  statuses: v.pipe(v.array(StatusMappingSchema), v.minLength(1)),
  events: v.pipe(v.array(EventMappingSchema), v.minLength(1)),
  lifts: v.pipe(v.array(LiftMappingSchema), v.minLength(1)),
  divisions: v.pipe(v.array(DivisionMappingSchema), v.minLength(1)),
  weightClasses: v.pipe(v.array(WeightClassMappingSchema), v.minLength(1)),
  unmappedWeightClasses: v.array(UnmappedWeightClassSchema),
  absentLocations: v.array(AbsentLocationSchema),
  placeholderHolders: v.array(PlaceholderHolderSchema),
  plausibility: PlausibilitySchema,
});
export type RecordSourceDocument = v.InferOutput<typeof RecordSourceDocumentSchema>;

/**
 * The crawl, as it is written.
 *
 * `columns` is checked against the order this file reads rather than merely
 * parsed. Cells are positional, so a crawler that reordered them would hand
 * every holder's name to the weight parser -- and the first thing that notices
 * is a lifter reading somebody else's total.
 */
const SnapshotSchema = v.object({
  partial: v.boolean(),
  columns: v.pipe(
    v.array(v.string()),
    v.check(
      (columns) =>
        columns.length === SNAPSHOT_COLUMNS.length &&
        SNAPSHOT_COLUMNS.every((column, index) => columns[index] === column),
      `the columns this build reads, in order: ${SNAPSHOT_COLUMNS.join(', ')}`,
    ),
  ),
  tables: v.pipe(
    v.array(
      v.object({
        location: NonEmpty,
        status: NonEmpty,
        event: NonEmpty,
        title: NonEmpty,
        rows: v.array(
          v.tuple([
            v.string(),
            v.string(),
            v.string(),
            v.string(),
            v.string(),
            v.string(),
            v.string(),
          ]),
        ),
      }),
    ),
    v.minLength(1),
  ),
  absent: v.array(
    v.object({
      target: v.object({ location: NonEmpty, status: NonEmpty, event: NonEmpty }),
      reason: NonEmpty,
    }),
  ),
});

type SnapshotTable = v.InferOutput<typeof SnapshotSchema>['tables'][number];
type SnapshotRow = SnapshotTable['rows'][number];

/**
 * A published row that was deliberately not published onward.
 *
 * Named apart from the classification adapter's identically shaped `WithheldRow`
 * rather than shared with it. One is a table a rulebook contradicts itself about
 * and the other is a row of a crawl; a single type across both would make either
 * one's reasons look applicable to the other in a signature.
 */
export interface WithheldRecordRow {
  /** Where the row sits, in the federation's own words. Never who set it. */
  readonly row: string;
  readonly reason: string;
}

export interface RecordSourceResult {
  readonly book: RecordBook;
  readonly freshness: SourceFreshness;
  /** Rows excluded by the rules below. Worth logging; never silent. */
  readonly withheld: readonly WithheldRecordRow[];
}

/**
 * Thrown when a mapping document or the crawl beside it is unusable.
 *
 * Carries every problem rather than the first, capped per kind so that one
 * thousand-fold mistake does not hide the other three.
 */
export class RecordSourceError extends Error {
  override readonly name = 'RecordSourceError';

  constructor(readonly problems: readonly string[]) {
    super(`Record source is unusable:\n  ${problems.join('\n  ')}`);
  }
}

/** What a caller has to know before it can supply the rest of the inputs. */
export interface RecordSourceReferences {
  /** Which federation's catalogue this mapping must be checked against. */
  readonly federationId: string;
  /** Which file in the snapshot directory holds the crawled tables. */
  readonly snapshotFile: string;
  /** Where the crawl starts, or `null`. */
  readonly snapshotUrl: string | null;
  /**
   * The template for one table's address, or `null`.
   *
   * Read by the crawler as well as by the build, so that the page a record links
   * to is the page the record was read from. See `record-tables.ts`.
   */
  readonly tableUrl: string | null;
}

/**
 * Reads what a caller needs before it can call {@link buildRecordBook}: whose
 * catalogue to fetch, and which file to read.
 *
 * This parses the document, and so does the build. Doing it twice costs
 * microseconds and keeps the build a single call taking the raw document, rather
 * than a two-step sequence every caller has to get in the right order.
 *
 * @throws {RecordSourceError} if the document does not parse.
 */
export function readRecordSourceReferences(document: unknown): RecordSourceReferences {
  const source = parseDocument(document);
  return {
    federationId: source.id,
    snapshotFile: source.snapshot.file,
    snapshotUrl: source.snapshot.url,
    tableUrl: source.tableUrl,
  };
}

/**
 * Validates a mapping against a crawl and builds the federation's record book.
 *
 * The catalogue is required, not optional: the mapping's whole job is to name
 * identifiers from it, and an identifier that does not exist there produces a
 * record no lookup will ever match.
 *
 * @throws {RecordSourceError} if anything does not line up.
 */
export function buildRecordBook(
  document: unknown,
  snapshot: unknown,
  catalog: CategoryCatalog,
): RecordSourceResult {
  const source = parseDocument(document);

  // Reported alone: while either is true every later message is noise.
  if (source.id !== catalog.id) {
    throw new RecordSourceError([
      `mapping is for federation "${source.id}" but was given the catalogue for "${catalog.id}"`,
    ]);
  }

  const crawl = parseSnapshot(snapshot, source.snapshot.file);
  if (crawl.partial) {
    // A `--limit` crawl is useful while working on the mapping and catastrophic
    // if published: whole regions would go out as though the federation had no
    // records in them, which is exactly how an empty category reads on screen.
    throw new RecordSourceError([
      `${source.snapshot.file}: is a partial crawl. Publishing it would report whole regions ` +
        'as having no records. Re-run the crawl without --limit.',
    ]);
  }

  const problems: string[] = [];
  checkMappingsAreUnambiguous(problems, source);
  checkMappingsNameRealCategories(problems, source, catalog);
  checkEveryPublishedValueIsMapped(problems, source, crawl.tables);
  checkAbsencesAreAccountedFor(problems, source, crawl);

  if (problems.length > 0) {
    // Nothing below can say anything useful while the vocabulary disagrees.
    throw new RecordSourceError(problems);
  }

  const built = buildRecords(problems, source, crawl.tables, catalog);
  if (problems.length > 0) {
    throw new RecordSourceError(problems);
  }

  // Against the contract the browser reads it with, not only against the checks
  // above: those are about meaning, and would happily pass a value that had lost
  // a required field on the way through this function.
  const validated = v.safeParse(RecordBookSchema, {
    id: source.id,
    label: source.book.label,
    minimumIncrementKilograms: source.book.minimumIncrementKilograms,
    higherSanctionIncrementKilograms: source.book.higherSanctionIncrementKilograms,
    matchTakesUnclaimedLevelIds: source.book.matchTakesUnclaimedLevelIds,
    sourceTables: built.sourceTables,
    records: built.records,
  });
  if (!validated.success) {
    throw new RecordSourceError(
      validated.issues.map((issue) => `built book: ${describeIssue(issue)}`),
    );
  }

  return {
    book: validated.output,
    withheld: built.withheld,
    freshness: {
      id: source.provenance.id,
      label: `${source.provenance.label} (${source.provenance.document})`,
      retrievedAt: source.provenance.retrievedAt,
      // Always `ok`. A crawl knows when it ran; it cannot know that a meet held
      // yesterday has not been entered upstream yet.
      status: 'ok',
    },
  };
}

function parseDocument(document: unknown): RecordSourceDocument {
  const parsed = v.safeParse(RecordSourceDocumentSchema, document);
  if (parsed.success) {
    return parsed.output;
  }
  throw new RecordSourceError(parsed.issues.map(describeIssue));
}

function parseSnapshot(value: unknown, file: string): v.InferOutput<typeof SnapshotSchema> {
  const parsed = v.safeParse(SnapshotSchema, value);
  if (parsed.success) {
    return parsed.output;
  }
  throw new RecordSourceError(parsed.issues.map((issue) => `${file}: ${describeIssue(issue)}`));
}

/**
 * Where a value failed and what was wanted there, never the value itself.
 *
 * A `check` action reports no `expected` and carries its wording in `message`
 * instead, so both are consulted. Every `check` in this file is given a message
 * for that reason: valibot's default one quotes the input it rejected, and these
 * documents sit beside a file full of people's names.
 */
function describeIssue(issue: v.BaseIssue<unknown>): string {
  return `${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected ?? issue.message}`;
}

/** Two mappings for one thing means the build has to guess. It does not guess. */
function checkMappingsAreUnambiguous(problems: string[], source: RecordSourceDocument): void {
  collectDuplicates(
    problems,
    'location',
    source.locations.map((entry) => entry.location),
  );
  // A level and region reached by two links is two sets of records for one
  // place, and the second silently replaces the first.
  collectDuplicates(
    problems,
    'level and region',
    source.locations.map((entry) => `${entry.levelId} / ${entry.regionId ?? '(no region)'}`),
  );
  collectDuplicates(
    problems,
    'status',
    source.statuses.map((entry) => entry.status),
  );
  // Two statuses with one tested flag would merge two published books into one,
  // and a lifter would be shown a tested record as an untested one or the other
  // way round -- both of which are a record they cannot actually beat.
  collectDuplicates(
    problems,
    'tested flag',
    source.statuses.map((entry) => String(entry.tested)),
  );
  collectDuplicates(
    problems,
    'event',
    source.events.map((entry) => entry.event),
  );
  collectDuplicates(
    problems,
    'discipline and equipment',
    source.events.map((entry) => `${entry.disciplineId} / ${entry.equipmentId}`),
  );
  collectDuplicates(
    problems,
    'lift column',
    source.lifts.map((entry) => entry.column),
  );
  collectDuplicates(
    problems,
    'lift',
    source.lifts.map((entry) => entry.lift),
  );
  collectDuplicates(
    problems,
    'division column',
    source.divisions.map((entry) => entry.column),
  );
  // Per sex, not across: one division exists for each sex and they are two
  // different sets of records.
  collectDuplicates(
    problems,
    'division',
    source.divisions.map((entry) => `${entry.sex} ${entry.divisionId}`),
  );
  collectDuplicates(
    problems,
    'weight class column',
    source.weightClasses.map((entry) => `${entry.sex} ${entry.column}`),
  );
  collectDuplicates(
    problems,
    'weight class',
    source.weightClasses.map((entry) => `${entry.sex} ${entry.weightClassId}`),
  );
  collectDuplicates(
    problems,
    'unmapped weight class column',
    source.unmappedWeightClasses.map((entry) => `${entry.sex} ${entry.column}`),
  );
  collectDuplicates(
    problems,
    'absent location',
    source.absentLocations.map((entry) => entry.location),
  );
  collectDuplicates(
    problems,
    'placeholder holder',
    source.placeholderHolders.map((entry) => normalizeHolder(entry.holder)),
  );
  collectDuplicates(problems, 'matchable level', source.book.matchTakesUnclaimedLevelIds);

  // A column that is both mapped and refused is a question with two answers, and
  // the refusal is the one that would silently win.
  const mapped = new Set(source.weightClasses.map((entry) => `${entry.sex} ${entry.column}`));
  for (const entry of source.unmappedWeightClasses) {
    if (mapped.has(`${entry.sex} ${entry.column}`)) {
      problems.push(
        `weight classes: ${entry.sex} "${entry.column}" is both mapped and listed as unmapped`,
      );
    }
  }

  const located = new Set(source.locations.map((entry) => entry.location));
  for (const entry of source.absentLocations) {
    if (located.has(entry.location)) {
      problems.push(`locations: "${entry.location}" is both mapped and listed as absent`);
    }
  }
}

/** Every identifier the mapping names has to exist in the catalogue. */
function checkMappingsNameRealCategories(
  problems: string[],
  source: RecordSourceDocument,
  catalog: CategoryCatalog,
): void {
  const levels = new Map(catalog.levels.map((level) => [level.id, level]));
  for (const entry of source.locations) {
    const level = levels.get(entry.levelId);
    if (level === undefined) {
      problems.push(
        `locations: "${entry.location}" maps to level "${entry.levelId}", which the catalogue does not define`,
      );
      continue;
    }
    // A region is `null` exactly when the level has none. It is never a
    // shorthand for "all of them": the browser builds its request from a level
    // and a region a lifter picked, so a record filed with no region under a
    // level that has them can never be asked for.
    if (entry.regionId === null) {
      if (level.regions.length > 0) {
        problems.push(
          `locations: "${entry.location}" names no region, but level "${entry.levelId}" is ` +
            'divided into regions, so nothing could ever ask for it',
        );
      }
    } else if (!level.regions.some((region) => region.id === entry.regionId)) {
      problems.push(
        `locations: "${entry.location}" maps to region "${entry.regionId}", which level ` +
          `"${entry.levelId}" does not contain`,
      );
    }

    // The heading is the only cross-check there is, so a region-scoped table
    // that does not name its region has nothing to check against.
    if ((entry.regionId === null) !== (entry.titleRegion === null)) {
      problems.push(
        `locations: "${entry.location}" names ${entry.regionId === null ? 'no region' : 'a region'} ` +
          `but ${entry.titleRegion === null ? 'no' : 'a'} region in its heading`,
      );
    }
  }

  // Every region the catalogue offers has to be reachable. A region added there
  // and not here is a question a lifter can answer and get nothing back from,
  // which reads exactly like a region with no records in it.
  const usedLevels = new Set(source.locations.map((entry) => entry.levelId));
  const reached = new Set(
    source.locations.map((entry) => `${entry.levelId} / ${entry.regionId ?? ''}`),
  );
  for (const level of catalog.levels) {
    if (!usedLevels.has(level.id)) {
      continue;
    }
    for (const region of level.regions) {
      if (!reached.has(`${level.id} / ${region.id}`)) {
        problems.push(
          `locations: the catalogue has region "${region.id}" under level "${level.id}", ` +
            'but no location maps to it',
        );
      }
    }
  }

  const disciplines = new Map(catalog.disciplines.map((entry) => [entry.id, entry]));
  const equipmentIds = new Set(catalog.equipment.map((entry) => entry.id));
  for (const entry of source.events) {
    if (!disciplines.has(entry.disciplineId)) {
      problems.push(
        `events: "${entry.event}" maps to discipline "${entry.disciplineId}", which the catalogue does not define`,
      );
    }
    if (!equipmentIds.has(entry.equipmentId)) {
      problems.push(
        `events: "${entry.event}" maps to equipment "${entry.equipmentId}", which the catalogue does not define`,
      );
    }
  }

  // A level named here and absent from the catalogue is a matching rule that can
  // never fire, and the failure is silent: every seeded record at that level is
  // published with a margin the rulebook does not ask for.
  for (const levelId of source.book.matchTakesUnclaimedLevelIds) {
    if (!levels.has(levelId)) {
      problems.push(
        `book: matchTakesUnclaimedLevelIds names level "${levelId}", which the catalogue does not define`,
      );
    }
  }

  const divisionIds = new Set(catalog.ageDivisions.divisions.map((division) => division.id));
  for (const entry of source.divisions) {
    if (!divisionIds.has(entry.divisionId)) {
      problems.push(
        `divisions: "${entry.column}" maps to "${entry.divisionId}", which the catalogue does not define`,
      );
    }
  }

  for (const entry of source.weightClasses) {
    const ladder = catalog.weightClassLadders.find((candidate) => candidate.sex === entry.sex);
    if (ladder === undefined) {
      problems.push(`weight classes: the catalogue has no ${entry.sex} ladder`);
      continue;
    }
    if (!ladder.classes.some((weightClass) => weightClass.id === entry.weightClassId)) {
      // Named against the ladder rather than the whole catalogue: a men's class
      // written under a women's column is the mistake worth naming precisely.
      problems.push(
        `weight classes: ${entry.sex} "${entry.column}" maps to "${entry.weightClassId}", ` +
          `which is not in the ${entry.sex} ladder`,
      );
    }
  }
}

/**
 * Every value the crawl publishes has to be mapped, and every mapping used.
 *
 * Distinct values are collected before anything is reported: one unmapped
 * division column appears in tens of thousands of rows and would otherwise bury
 * every other problem in the run.
 */
function checkEveryPublishedValueIsMapped(
  problems: string[],
  source: RecordSourceDocument,
  tables: readonly SnapshotTable[],
): void {
  const published = {
    locations: new Set<string>(),
    statuses: new Set<string>(),
    events: new Set<string>(),
    divisions: new Set<string>(),
    lifts: new Set<string>(),
    weightClassesBySex: new Set<string>(),
  };

  const sexByDivision = new Map(source.divisions.map((entry) => [entry.column, entry.sex]));

  for (const table of tables) {
    published.locations.add(table.location);
    published.statuses.add(table.status);
    published.events.add(table.event);
    for (const row of table.rows) {
      const [division, weightClass, lift] = row;
      published.divisions.add(division);
      published.lifts.add(lift);
      const sex = sexByDivision.get(division);
      if (sex !== undefined) {
        published.weightClassesBySex.add(`${sex} ${weightClass}`);
      }
    }
  }

  compareBothWays(
    problems,
    'location',
    published.locations,
    new Set(source.locations.map((entry) => entry.location)),
  );
  compareBothWays(
    problems,
    'status',
    published.statuses,
    new Set(source.statuses.map((entry) => entry.status)),
  );
  compareBothWays(
    problems,
    'event',
    published.events,
    new Set(source.events.map((entry) => entry.event)),
  );
  compareBothWays(
    problems,
    'division column',
    published.divisions,
    new Set(source.divisions.map((entry) => entry.column)),
  );
  compareBothWays(
    problems,
    'lift column',
    published.lifts,
    new Set(source.lifts.map((entry) => entry.column)),
  );

  // Only once every published division is mapped: a weight class is keyed by the
  // sex its division column carries, so an unmapped division makes every class
  // published under it look missing too -- and the real problem is one line up.
  if ([...published.divisions].every((column) => sexByDivision.has(column))) {
    const accounted = new Set([
      ...source.weightClasses.map((entry) => `${entry.sex} ${entry.column}`),
      ...source.unmappedWeightClasses.map((entry) => `${entry.sex} ${entry.column}`),
    ]);
    compareBothWays(problems, 'weight class column', published.weightClassesBySex, accounted);
  }
}

/**
 * Every place the site links to either has records or has a reason.
 *
 * Both directions, and both of them matter. A location listed as absent that
 * starts answering is a region whose records are never published; a location
 * that stops answering without being listed is what a region's records
 * disappearing looks like from here.
 */
function checkAbsencesAreAccountedFor(
  problems: string[],
  source: RecordSourceDocument,
  crawl: v.InferOutput<typeof SnapshotSchema>,
): void {
  const present = new Set(crawl.tables.map((table) => table.location));
  const unanswered = new Set(crawl.absent.map((entry) => entry.target.location));
  const listed = new Set(source.absentLocations.map((entry) => entry.location));

  for (const location of [...unanswered].sort(compare)) {
    if (present.has(location)) {
      // Some of its tables answered and some did not. Left alone this publishes
      // part of a region's records with nothing on screen to say the rest are
      // missing, which is indistinguishable from a region that holds fewer.
      problems.push(
        `absences: "${location}" answered for some of its tables and not others. Re-run the ` +
          'crawl; if it is permanent, the mapping needs to say so per table rather than per location.',
      );
      continue;
    }
    if (!listed.has(location)) {
      problems.push(
        `absences: the crawl reached no tables for "${location}", which nothing accounts for`,
      );
    }
  }

  for (const entry of source.absentLocations) {
    if (present.has(entry.location)) {
      problems.push(
        `absences: "${entry.location}" is listed as absent but the crawl read its tables. ` +
          `Remove the entry: "${entry.reason}"`,
      );
    } else if (!unanswered.has(entry.location)) {
      problems.push(
        `absences: "${entry.location}" is listed as absent but the crawl never tried it. ` +
          `Remove the entry: "${entry.reason}"`,
      );
    }
  }
}

interface BuiltRecords {
  readonly records: readonly FederationRecord[];
  readonly withheld: readonly WithheldRecordRow[];
  /** One per table actually read, so a link is never offered to a page the crawl never saw. */
  readonly sourceTables: readonly RecordSourceTable[];
}

/** Everything one table's three identifiers resolve to. */
interface TableScope {
  readonly levelId: string;
  readonly regionId: string | null;
  readonly tested: boolean;
  readonly disciplineId: string;
  readonly equipmentId: string;
  readonly lifts: ReadonlySet<Lift>;
}

/**
 * Turns every published row into a record, or into a reason it is not one.
 *
 * Also the point at which each table's own heading is checked. That has to
 * happen with the mappings in hand, and it is the strongest check available:
 * the whole expected heading is reconstructed and compared, rather than its
 * parts counted, so a segment in the wrong order fails as loudly as a wrong one.
 */
function buildRecords(
  problems: string[],
  source: RecordSourceDocument,
  tables: readonly SnapshotTable[],
  catalog: CategoryCatalog,
): BuiltRecords {
  const locations = new Map(source.locations.map((entry) => [entry.location, entry]));
  const statuses = new Map(source.statuses.map((entry) => [entry.status, entry]));
  const events = new Map(source.events.map((entry) => [entry.event, entry]));
  const liftsByColumn = new Map(source.lifts.map((entry) => [entry.column, entry.lift]));
  const divisions = new Map(source.divisions.map((entry) => [entry.column, entry]));
  const weightClasses = new Map(
    source.weightClasses.map((entry) => [`${entry.sex} ${entry.column}`, entry.weightClassId]),
  );
  const refusedClasses = new Map(
    source.unmappedWeightClasses.map((entry) => [`${entry.sex} ${entry.column}`, entry.reason]),
  );
  // Which lifts a table contests comes from the catalogue's discipline, not from
  // the mapping. The mapping says which column is which lift; the rulebook says
  // whether a bench-only book has a deadlift in it, and only one of those two can
  // be right about a total.
  const disciplineLifts = new Map(
    catalog.disciplines.map((discipline) => [discipline.id, new Set(discipline.lifts)]),
  );

  const placeholders = new Set(
    source.placeholderHolders.map((entry) => normalizeHolder(entry.holder)),
  );

  const records: FederationRecord[] = [];
  const withheld: WithheldRecordRow[] = [];
  const sourceTables: RecordSourceTable[] = [];
  const headings: string[] = [];
  const lost: string[] = [];
  const unreadable: string[] = [];
  const collisions: string[] = [];
  const seen = new Set<string>();
  const claimedPlaceholders = new Set<string>();

  for (const table of tables) {
    const location = locations.get(table.location);
    const status = statuses.get(table.status);
    const event = events.get(table.event);
    const lifts = event === undefined ? undefined : disciplineLifts.get(event.disciplineId);
    if (
      location === undefined ||
      status === undefined ||
      event === undefined ||
      lifts === undefined
    ) {
      lost.push(`${tableKey(table)}: an identifier lost its mapping between checking and building`);
      continue;
    }

    const expected = [
      location.titleLevel,
      status.titleStatus,
      ...(location.titleRegion === null ? [] : [location.titleRegion]),
      event.titleGear,
      event.titleEvent,
    ].join('/');
    if (table.title !== expected) {
      headings.push(
        `${tableKey(table)}: is headed "${table.title}" but the mapping expects "${expected}"`,
      );
      continue;
    }

    const scope: TableScope = {
      levelId: location.levelId,
      regionId: location.regionId,
      tested: status.tested,
      disciplineId: event.disciplineId,
      equipmentId: event.equipmentId,
      lifts,
    };

    // Built here rather than from the mapping's cross product, so that the list
    // holds only tables the crawl actually read and whose heading agreed. A link
    // is an invitation to check the figure; one that leads nowhere is worse than
    // no link at all.
    if (source.tableUrl !== null) {
      sourceTables.push({
        levelId: scope.levelId,
        regionId: scope.regionId,
        tested: scope.tested,
        equipmentId: scope.equipmentId,
        disciplineId: scope.disciplineId,
        url: buildRecordTableUrl(source.tableUrl, table),
      });
    }

    for (const row of table.rows) {
      const where = rowKey(table, row);
      const [divisionColumn, weightClassColumn, liftColumn] = row;

      const division = divisions.get(divisionColumn);
      const lift = liftsByColumn.get(liftColumn);
      if (division === undefined || lift === undefined) {
        lost.push(`${where}: an axis value lost its mapping between checking and building`);
        continue;
      }

      const classKey = `${division.sex} ${weightClassColumn}`;
      const weightClassId = weightClasses.get(classKey);
      if (weightClassId === undefined) {
        const reason = refusedClasses.get(classKey);
        withheld.push({
          row: where,
          reason: reason ?? `no ${division.sex} class is mapped for "${weightClassColumn}"`,
        });
        continue;
      }

      if (!scope.lifts.has(lift)) {
        // A deadlift printed on a bench-only table. Published onward it would be
        // a bench-only record for a lift that meet did not contest.
        withheld.push({
          row: where,
          reason: `discipline "${scope.disciplineId}" does not contest the ${lift}`,
        });
        continue;
      }

      const kilograms = readKilograms(unreadable, where, row, lift, source.plausibility);
      if (kilograms === null) {
        continue;
      }
      if (typeof kilograms === 'string') {
        withheld.push({ row: where, reason: kilograms });
        continue;
      }

      const achievedOn = readAchievedOn(unreadable, where, row);
      if (achievedOn === undefined) {
        continue;
      }

      const holder = readHolder(row);
      const unclaimed = holder !== null && placeholders.has(normalizeHolder(holder));
      if (unclaimed) {
        claimedPlaceholders.add(normalizeHolder(holder));
      }

      const id = [
        source.id,
        scope.levelId,
        scope.regionId ?? 'all',
        division.sex,
        scope.equipmentId,
        scope.disciplineId,
        weightClassId,
        division.divisionId,
        scope.tested ? 'tested' : 'untested',
        lift,
      ].join('/');
      if (seen.has(id)) {
        // Two published rows for one category. Left alone one silently replaces
        // the other, and which one wins depends on crawl order.
        collisions.push(`${where}: is the second published record for "${id}"`);
        continue;
      }
      seen.add(id);

      records.push({
        id,
        scope: {
          levelId: scope.levelId,
          regionId: scope.regionId,
          sex: division.sex,
          equipmentId: scope.equipmentId,
          disciplineId: scope.disciplineId,
          weightClassId,
          divisionId: division.divisionId,
          tested: scope.tested,
          lift,
        },
        kilograms,
        unclaimed,
        // A seeded record has no holder, and the founding date the federation
        // stamps it with is not a date any lift was made -- printing it asserts
        // one happened. The date is parsed above regardless of this, and then
        // dropped: that parse is what notices the column has shifted, and
        // skipping it on a tenth of the corpus would blind the check on exactly
        // the rows that are most alike.
        holderName: unclaimed ? null : holder,
        achievedOn: unclaimed ? null : achievedOn,
        // The tables carry no meet name. `null` says the source omits it, which
        // is true; inventing one from the date would be a guess on screen.
        meetName: null,
      });
    }
  }

  reportCapped(problems, 'headings', headings);
  reportCapped(problems, 'mappings', lost);
  reportCapped(problems, 'figures', unreadable);
  reportCapped(problems, 'collisions', collisions);

  // One direction only, and the other is the reason this matters. A placeholder
  // that stopped appearing is reported here; a placeholder the federation
  // started using and nobody mapped is indistinguishable from a lifter, and the
  // corpus quietly gains a prolific record holder. So a stale entry is worth
  // knowing about before somebody tidies it away as unused.
  for (const entry of source.placeholderHolders) {
    if (!claimedPlaceholders.has(normalizeHolder(entry.holder))) {
      problems.push(
        `placeholder holders: "${entry.holder}" is mapped as a placeholder and appears in no ` +
          'published row. Either the federation renamed it -- in which case the new wording is ' +
          'being published as a lifter -- or it is gone.',
      );
    }
  }

  if (withheld.length > source.plausibility.maximumExcludedRows) {
    // The check that catches a parser regression. Every exclusion above is one a
    // shifted column satisfies for thousands of rows at once, and the result
    // without this is a successful build publishing a fraction of the records.
    problems.push(
      `exclusions: ${String(withheld.length)} rows were excluded, and the mapping allows ` +
        `${String(source.plausibility.maximumExcludedRows)}. Either the tables changed shape or ` +
        'the budget needs revisiting; do not raise it without reading the reasons.',
    );
  }

  // Sorted by identifier rather than left in crawl order. Artifacts are
  // content-addressed, so a source that merely reordered its rows would
  // otherwise rewrite every filename and evict a cache that was still correct.
  return {
    records: records.sort((left, right) => compare(left.id, right.id)),
    withheld,
    sourceTables: sourceTables.sort((left, right) => compare(left.url, right.url)),
  };
}

/**
 * Reads a row's weight: the figure, a reason to withhold it, or `null` if it
 * could not be read at all.
 *
 * Three outcomes rather than two because they are three different situations. A
 * figure outside the plausibility band is a row this build declines to publish
 * and counts against the budget; a figure that is not a number at all is a
 * parser problem, and no budget should absorb it.
 */
function readKilograms(
  unreadable: string[],
  where: string,
  row: SnapshotRow,
  lift: Lift,
  plausibility: RecordSourceDocument['plausibility'],
): number | string | null {
  const parsed = parseKilograms(row[4]);
  if (!parsed.ok) {
    unreadable.push(`${where}: ${parsed.reason}`);
    return null;
  }

  const ceiling =
    lift === 'total' ? plausibility.maximumTotalKilograms : plausibility.maximumSingleLiftKilograms;
  if (parsed.kilograms < plausibility.minimumKilograms) {
    return `figure is below ${String(plausibility.minimumKilograms)} kg`;
  }
  if (parsed.kilograms > ceiling) {
    return `figure is above ${String(ceiling)} kg for a ${lift}`;
  }
  return parsed.kilograms;
}

/** The date the record was set, in ISO form, or `undefined` if it is unreadable. */
function readAchievedOn(
  unreadable: string[],
  where: string,
  row: SnapshotRow,
): string | null | undefined {
  const raw = row[6].trim();
  if (raw === '') {
    return null;
  }

  // The tables print two forms, and both are the federation's. Normalising here
  // rather than in the crawler keeps the snapshot a record of what was served.
  const american = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(raw);
  const iso =
    american === null ? raw : `${american[3] ?? ''}-${american[1] ?? ''}-${american[2] ?? ''}`;

  const parsed = parsePlainDate(iso);
  if (!parsed.ok) {
    // `parsePlainDate` never quotes its input, which is right for a date of
    // birth and merely unhelpful here -- so the position says where to look.
    unreadable.push(`${where}: the date is unreadable: ${parsed.reason}`);
    return undefined;
  }
  return formatPlainDate(parsed.date);
}

/**
 * The holder's name with its whitespace tidied, and nothing else touched.
 *
 * Nearly a thousand rows arrive padded or doubly spaced, which is a rendering
 * artefact and safe to fix. Everything else is left exactly as published: an
 * accent, a suffix or an unusual capitalisation is how somebody's name is
 * spelled, and a build has no business correcting it.
 */
function readHolder(row: SnapshotRow): string | null {
  const holder = row[3].replace(/\s+/gu, ' ').trim();
  return holder === '' ? null : holder;
}

/**
 * One holder cell, in the form placeholders are compared in.
 *
 * Case-folded because these tables are hand-maintained across fifty-odd pages
 * and "Record preset" is one keystroke from "Record Preset". A case-sensitive
 * comparison would publish the variant as a lifter, and the corpus would gain a
 * record holder with several thousand records and no way to notice.
 */
function normalizeHolder(holder: string): string {
  return holder.replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** One table, named the way the site's own links name it. */
function tableKey(table: SnapshotTable): string {
  return `${table.location}/${table.status}/${table.event}`;
}

/** One row, named by position. Never by holder -- see the header. */
function rowKey(table: SnapshotTable, row: SnapshotRow): string {
  return `${tableKey(table)} / ${row[0]} / ${row[1]} / ${row[2]}`;
}

/**
 * Reports what one side has and the other lacks, in both directions.
 *
 * A value published and not mapped is a federation that added something. A value
 * mapped and not published is one that removed something. Both are worth
 * knowing, and neither is visible from the other side.
 */
function compareBothWays(
  problems: string[],
  what: string,
  published: ReadonlySet<string>,
  mapped: ReadonlySet<string>,
): void {
  for (const value of [...published].sort(compare)) {
    if (!mapped.has(value)) {
      problems.push(`${what}: the crawl uses "${value}", which nothing maps`);
    }
  }
  for (const value of [...mapped].sort(compare)) {
    if (!published.has(value)) {
      problems.push(`${what}: "${value}" is mapped but the crawl never uses it`);
    }
  }
}

function collectDuplicates(problems: string[], what: string, values: readonly string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  for (const duplicate of [...duplicates].sort(compare)) {
    problems.push(`${what}: "${duplicate}" is used more than once`);
  }
}

/** Adds a bounded number of one kind of problem, and counts the rest. */
function reportCapped(problems: string[], what: string, messages: readonly string[]): void {
  problems.push(...messages.slice(0, MAXIMUM_REPORTED));
  if (messages.length > MAXIMUM_REPORTED) {
    problems.push(
      `${what}: and ${String(messages.length - MAXIMUM_REPORTED)} more of the same kind`,
    );
  }
}

/** Code-unit ordering, so the result does not depend on the build machine's locale. */
function compare(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
