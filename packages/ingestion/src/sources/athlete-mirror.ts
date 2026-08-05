// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  athleteLookupKey,
  type AthleteEntry,
  type AthleteHistory,
  type AthleteMirrorInfo,
  type SourceFreshness,
} from '@platform-toolkit/data-contracts';
import * as v from 'valibot';

/**
 * Turning a bulk competition archive into a mirror of the lifters this
 * collection is for.
 *
 * The upstream corpus is one comma-separated file of roughly four million
 * entries covering every federation there has ever been. Two things follow from
 * that and shape everything in this file.
 *
 * IT IS TOO BIG TO PUBLISH AND TOO BIG TO HOLD
 *
 * At the width this projection serializes to, four million entries come to about
 * 1.4 GB of JSON, which is past what GitHub Pages will publish at all (ADR 2) and
 * would be so before a single record shard was counted. So the mirror is scoped,
 * and the scope is **every entry of every lifter who has at least one entry under
 * a federation the source document names**. Measured on the 2026-08-01 corpus:
 * 3,995,881 entries in, 96,695 lifters touched USPA or IPL, and mirroring their
 * whole competitive lives -- 423 other federations included -- comes to 593,144
 * entries and 217 MB.
 *
 * Note which half of that is generous. The audience is narrow, on purpose; what a
 * lifter in it gets is *complete*. Somebody who spent five years in USAPL before
 * their first USPA meet sees those five years, because a qualifying total is a
 * qualifying total wherever it was lifted, and a mirror that dropped it would
 * quietly tell them they had never made the standard.
 *
 * A lifter outside the scope is told plainly that no results were found and is
 * given the manual route, which must stay fully usable on its own. That is what
 * makes the scope a performance decision rather than a correctness one: the
 * screen can always be completed by hand.
 *
 * IT HAS TO BE READ TWICE
 *
 * The scope rule is a fact about a *lifter* and the file is a list of *entries*,
 * so nothing about the first row can be decided until the last one has been
 * seen. Rather than hold four million projected entries in memory against the
 * chance they turn out to be wanted, this reads the file once to learn who is in
 * scope and once to project them. Hence `openRows`, which is a factory and not an
 * iterable: an iterable can only be walked once, and a caller who handed one over
 * would get an empty mirror and no error.
 *
 * WHAT NO MESSAGE IN THIS FILE MAY CONTAIN
 *
 * A lifter's name (section 2.3). Every problem names a row number, a column, or a
 * count. A corpus this size would otherwise put tens of thousands of names into a
 * CI log that is kept forever, and unlike a record holder -- whose name the
 * federation publishes beside their lift -- these are people who have consented
 * to nothing beyond their results being public.
 */

const NonEmpty = v.pipe(v.string(), v.minLength(1));

/**
 * How many of one kind of problem are printed before the rest are counted.
 *
 * Matches the record adapter, for the same reason: a projection mistake is never
 * singular, and printing all of it buries every other problem in the run.
 */
const MAXIMUM_REPORTED = 20;

/** Where the archive came from and when. */
const ProvenanceSchema = v.object({
  id: NonEmpty,
  label: NonEmpty,
  document: NonEmpty,
  url: v.pipe(
    v.string(),
    v.url(),
    v.check((value) => value.startsWith('https://'), 'an https URL'),
  ),

  /**
   * The attribution the upstream licence asks for, carried so that the screen
   * showing this data can print it.
   *
   * In the document rather than in this file because it is the publisher's words
   * and not ours, and because a licence that changes should be a diff somebody
   * reviews rather than a string edit in a source file nobody reads.
   */
  attribution: NonEmpty,

  retrievedAt: v.pipe(v.string(), v.isoTimestamp()),
});

/**
 * Which lifters the mirror is for.
 *
 * Federation identifiers are data and never source (section 5.1), and this is the
 * sharpest case of that rule in the project: the two lists below decide which
 * ninety-odd thousand people out of a million are published at all. Hard-coding
 * them would make "who is this collection for" a question you answer by reading
 * a TypeScript file.
 *
 * Two lists rather than one, because the corpus distinguishes the body that
 * sanctioned a meet from the body it answers to, and the useful rule needs both:
 * an affiliate names itself in `Federation` and its parent in `ParentFederation`,
 * so matching only the first misses every international meet and matching only
 * the second misses every meet run by a federation the archive files as its own
 * parent.
 */
const ScopeSchema = v.object({
  /** Matched against the corpus's own `Federation` column, exactly. */
  federations: v.pipe(v.array(NonEmpty), v.minLength(1)),
  /** Matched against its `ParentFederation` column, exactly. */
  parentFederations: v.array(NonEmpty),
});

/**
 * The two numbers that stop a parser regression from publishing a fraction of
 * the corpus and calling it a build.
 *
 * A rule that quietly starts withholding everything looks exactly like a quiet
 * week upstream, and the artifact it produces is valid -- it is simply mostly
 * empty. Both bounds are declared in the document rather than computed, so
 * moving one is a diff with a person's name on it.
 */
const BoundsSchema = v.object({
  /**
   * The fewest entries a healthy build produces.
   *
   * A floor, never an exact count. An exact count would fail every week *for
   * being right*, unattended, with nobody to tell it so -- the same reasoning
   * that keeps a record total out of `records.data.test.ts`.
   */
  minimumEntries: v.pipe(v.number(), v.integer(), v.minValue(1)),

  /** The most rows that may be withheld before the build is wrong rather than the data. */
  maximumWithheldRows: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

/** The curated document that says what to mirror and where it came from. */
export const AthleteMirrorDocumentSchema = v.object({
  id: NonEmpty,
  label: NonEmpty,
  provenance: ProvenanceSchema,
  scope: ScopeSchema,
  bounds: BoundsSchema,

  /**
   * Who is in the mirror, in a sentence a reader can check themselves against.
   *
   * Prose, and therefore data rather than source: it states the scope the two
   * federation lists above encode, and the two have to be edited together. A
   * sentence in a component would go on saying "USPA and IPL lifters" the day
   * somebody adds a third list and forgets it, which is a confident wrong answer
   * given to exactly the people the scope was widened for.
   */
  scopeNote: NonEmpty,
});
export type AthleteMirrorDocument = v.InferOutput<typeof AthleteMirrorDocumentSchema>;

/**
 * The columns this projection reads, and nothing else.
 *
 * Named rather than indexed. The archive has grown columns before and will
 * again, and a projection pinned to position 34 publishes the wrong field the
 * first time somebody inserts one -- silently, because every value in the file is
 * a plausible string. Reading the header means an inserted column costs nothing
 * and a *removed* one fails the build under its own name.
 */
const REQUIRED_COLUMNS = [
  'Name',
  'Sex',
  'Event',
  'Equipment',
  'Age',
  'AgeClass',
  'Division',
  'BodyweightKg',
  'WeightClassKg',
  'Best3SquatKg',
  'Best3BenchKg',
  'Best3DeadliftKg',
  'TotalKg',
  'Place',
  'Tested',
  'Federation',
  'ParentFederation',
  'Date',
  'MeetName',
] as const;

type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

/** Where each required column sits in this particular file. */
export type CorpusColumns = Readonly<Record<RequiredColumn, number>>;

/** Thrown when the archive is not the shape this adapter can read. */
export class AthleteCorpusError extends Error {
  override readonly name = 'AthleteCorpusError';
}

/** One withheld row: where it was, and which rule dropped it. */
export interface WithheldEntryRow {
  /** The line number in the archive, counting the header as line 1. */
  readonly line: number;
  readonly reason: string;
}

export interface AthleteMirror {
  readonly id: string;
  readonly label: string;
  /** Every mirrored lifter, ordered by key. Keys may repeat; see `findAthleteHistories`. */
  readonly athletes: readonly AthleteHistory[];
}

export interface AthleteMirrorResult {
  readonly mirror: AthleteMirror;

  /**
   * What the mirror is, ready to publish beside it.
   *
   * Built here rather than by the publisher because every field of it is either
   * copied out of the curated document or counted off the mirror this function
   * just produced. A publisher that assembled it would be a second reader of the
   * same document, and the failure is a credit or a scope sentence that stops
   * matching the data it is printed under.
   */
  readonly info: AthleteMirrorInfo;

  readonly freshness: SourceFreshness;
  readonly withheld: readonly WithheldEntryRow[];
}

/**
 * Reads the archive's header row and locates every column this adapter needs.
 *
 * @throws {AthleteCorpusError} if a required column is absent or duplicated.
 */
export function readCorpusColumns(headerLine: string): CorpusColumns {
  const cells = headerLine.split(',');
  const positions = new Map<string, number>();
  const duplicated: string[] = [];

  for (const [index, cell] of cells.entries()) {
    if (positions.has(cell)) {
      duplicated.push(cell);
      continue;
    }
    positions.set(cell, index);
  }

  // Two problems, both reported, because a header that has gone wrong has
  // usually gone wrong in more than one place and one rebuild per column is a
  // long afternoon (section 5.5, report everything at once).
  const missing = REQUIRED_COLUMNS.filter((column) => !positions.has(column));
  const duplicatedRequired = REQUIRED_COLUMNS.filter((column) => duplicated.includes(column));

  if (missing.length > 0 || duplicatedRequired.length > 0) {
    const problems: string[] = [];
    if (missing.length > 0) {
      problems.push(`missing ${missing.join(', ')}`);
    }
    if (duplicatedRequired.length > 0) {
      problems.push(`duplicated ${duplicatedRequired.join(', ')}`);
    }
    throw new AthleteCorpusError(
      `The archive header is not the shape this adapter reads: ${problems.join('; ')}.`,
    );
  }

  // Spelled out rather than built in a loop and asserted. A loop over
  // `REQUIRED_COLUMNS` produces a `Partial<…>` that only a cast turns into the
  // real type, and a cast is exactly the thing that would go on compiling if a
  // column were later added to the list and not to the object.
  const at = (column: RequiredColumn): number => {
    const position = positions.get(column);
    if (position === undefined) {
      // Unreachable: `missing` was empty. Thrown rather than defaulted, because
      // a default here is a column index of 0, which reads the name field as
      // every other field and publishes a mirror of nonsense.
      throw new AthleteCorpusError(`Column ${column} was located and then lost.`);
    }
    return position;
  };

  return {
    Name: at('Name'),
    Sex: at('Sex'),
    Event: at('Event'),
    Equipment: at('Equipment'),
    Age: at('Age'),
    AgeClass: at('AgeClass'),
    Division: at('Division'),
    BodyweightKg: at('BodyweightKg'),
    WeightClassKg: at('WeightClassKg'),
    Best3SquatKg: at('Best3SquatKg'),
    Best3BenchKg: at('Best3BenchKg'),
    Best3DeadliftKg: at('Best3DeadliftKg'),
    TotalKg: at('TotalKg'),
    Place: at('Place'),
    Tested: at('Tested'),
    Federation: at('Federation'),
    ParentFederation: at('ParentFederation'),
    Date: at('Date'),
    MeetName: at('MeetName'),
  };
}

/**
 * Projects one row, or says why it was withheld.
 *
 * Exported for its tests. The withheld reasons are the interesting half: each one
 * is a rule, never a list of rows to skip, because a quarantine list goes stale
 * between one weekly refresh and the next and then fails on a row nobody has had
 * a chance to look at.
 */
export function projectCorpusRow(
  cells: readonly string[],
  columns: CorpusColumns,
): { readonly key: string; readonly name: string; readonly entry: AthleteEntry } | string {
  const read = (column: RequiredColumn): string => cells[columns[column]] ?? '';

  const name = read('Name');
  const key = athleteLookupKey(name);
  if (key === null) {
    // A name written in a script with no Latin letters. Nothing survives the
    // fold, so there is no key to publish it under and no key a visitor could
    // type to find it. 4,914 rows on the corpus this was measured against.
    return 'the name reduces to no lookup key';
  }

  const date = read('Date');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    // The date is not a display detail: every question this mirror answers is
    // scoped to a window, and a row with no day cannot be inside or outside one.
    return 'the date is not YYYY-MM-DD';
  }

  for (const column of ['Federation', 'MeetName', 'Event', 'Equipment', 'Sex'] as const) {
    if (read(column) === '') {
      return `${column} is empty`;
    }
  }

  const weights = readWeights(read);
  if (typeof weights === 'string') {
    return weights;
  }

  const age = readAge(read('Age'));
  if (age === 'malformed') {
    return 'Age is neither blank nor a whole or half year';
  }

  return {
    key,
    name,
    entry: {
      date,
      federation: read('Federation'),
      parentFederation: blankToNull(read('ParentFederation')),
      meetName: read('MeetName'),
      event: read('Event'),
      equipment: read('Equipment'),
      division: blankToNull(read('Division')),
      ageClass: blankToNull(read('AgeClass')),
      age,
      // "Yes" or blank, and blank is silence rather than a denial. See the
      // contract; this is the axis somebody is turned away at weigh-in over.
      tested: read('Tested') === 'Yes' ? true : null,
      sex: read('Sex'),
      bodyweightKg: weights.bodyweightKg,
      weightClassKg: blankToNull(read('WeightClassKg')),
      squatKg: weights.squatKg,
      benchKg: weights.benchKg,
      deadliftKg: weights.deadliftKg,
      totalKg: weights.totalKg,
      place: blankToNull(read('Place')),
    },
  };
}

/**
 * Builds the mirror.
 *
 * @param document curated source document, unvalidated
 * @param openRows opens the archive for reading, header row included. Called
 *   twice; see the header for why it is a factory.
 *
 * @throws {AthleteCorpusError} if the header is unreadable, if fewer entries
 *   survive than the document's floor, or if more rows are withheld than its
 *   budget allows.
 */
export async function buildAthleteMirror(
  document: unknown,
  openRows: () => AsyncIterable<string>,
): Promise<AthleteMirrorResult> {
  const parsed = v.parse(AthleteMirrorDocumentSchema, document);
  const federations = new Set(parsed.scope.federations);
  const parentFederations = new Set(parsed.scope.parentFederations);

  const firstPass = await readColumns(openRows);
  const inScope = new Set<string>();
  for await (const { cells } of firstPass.rows) {
    const federation = cells[firstPass.columns.Federation] ?? '';
    const parent = cells[firstPass.columns.ParentFederation] ?? '';
    if (federations.has(federation) || parentFederations.has(parent)) {
      // Keyed on the archive's own name rather than on the lookup key. The fold
      // is lossy, and two lifters who fold together are two lifters: taking one
      // of them into scope must not drag the other in behind them.
      inScope.add(cells[firstPass.columns.Name] ?? '');
    }
  }

  const secondPass = await readColumns(openRows);
  const histories = new Map<string, { key: string; name: string; entries: AthleteEntry[] }>();
  const withheld: WithheldEntryRow[] = [];
  let entryCount = 0;

  // Repeated column values are shared rather than re-allocated. Six hundred
  // thousand entries hold about a dozen short strings each, nearly all of them
  // drawn from a few hundred distinct values, and letting each row keep its own
  // copy is the difference between a build that fits in the runner's memory and
  // one that does not.
  const pool = new Map<string, string>();
  const intern = (value: string): string => {
    const existing = pool.get(value);
    if (existing !== undefined) {
      return existing;
    }
    pool.set(value, value);
    return value;
  };

  for await (const { line, cells } of secondPass.rows) {
    if (!inScope.has(cells[secondPass.columns.Name] ?? '')) {
      continue;
    }

    const projected = projectCorpusRow(cells, secondPass.columns);
    if (typeof projected === 'string') {
      withheld.push({ line, reason: projected });
      continue;
    }

    entryCount += 1;
    // Grouped by the archive's own name, not by the lookup key, so two lifters
    // who fold to one key stay two histories. Merging them would show somebody
    // another person's total on a screen whose whole job is to be checkable.
    const existing = histories.get(projected.name);
    const entry = internEntry(projected.entry, intern);
    if (existing === undefined) {
      histories.set(projected.name, {
        key: projected.key,
        name: projected.name,
        entries: [entry],
      });
      continue;
    }
    existing.entries.push(entry);
  }

  if (entryCount < parsed.bounds.minimumEntries) {
    throw new AthleteCorpusError(
      `Only ${String(entryCount)} entries survived, under the floor of ` +
        `${String(parsed.bounds.minimumEntries)}. Either the archive shrank or a rule in this ` +
        'adapter stopped matching; publishing the remainder would look like a quiet week.',
    );
  }

  if (withheld.length > parsed.bounds.maximumWithheldRows) {
    throw new AthleteCorpusError(
      `${String(withheld.length)} rows were withheld, over the budget of ` +
        `${String(parsed.bounds.maximumWithheldRows)}:\n  ${summarizeWithheld(withheld)}`,
    );
  }

  // Sorted, and by key rather than by name, because that is the order a reader
  // looks one up in. Artifacts are content-addressed, so an archive that merely
  // reordered its rows would otherwise rewrite every filename and evict a cache
  // that was still correct.
  const athletes = [...histories.values()]
    .map((history) => ({
      key: history.key,
      name: history.name,
      // Oldest first. The corpus is not ordered by date and a history read in
      // file order reads as noise.
      entries: [...history.entries].sort(compareEntries),
    }))
    .sort((left, right) => compare(left.key, right.key) || compare(left.name, right.name));

  return {
    mirror: { id: parsed.id, label: parsed.label, athletes },
    info: {
      id: parsed.id,
      label: parsed.label,
      attribution: parsed.provenance.attribution,
      sourceUrl: parsed.provenance.url,
      scopeNote: parsed.scopeNote,
      // Counted off what was actually built, never taken from the document. A
      // figure the document declared would be a promise about the data rather
      // than a description of it, and the two would part company silently.
      athleteCount: athletes.length,
      entryCount,
    },
    freshness: {
      id: parsed.provenance.id,
      label: parsed.provenance.label,
      retrievedAt: parsed.provenance.retrievedAt,
      status: 'ok',
    },
    withheld,
  };
}

/** Opens the archive and consumes its header, leaving an iterator over data rows. */
async function readColumns(openRows: () => AsyncIterable<string>): Promise<{
  readonly columns: CorpusColumns;
  readonly rows: AsyncIterable<{ readonly line: number; readonly cells: readonly string[] }>;
}> {
  const iterator = openRows()[Symbol.asyncIterator]();
  const header = await iterator.next();
  if (header.done === true) {
    throw new AthleteCorpusError('The archive is empty; it has not even a header row.');
  }
  const columns = readCorpusColumns(header.value);

  return {
    columns,
    rows: {
      async *[Symbol.asyncIterator](): AsyncGenerator<{
        readonly line: number;
        readonly cells: readonly string[];
      }> {
        // Counted here, over every physical line, rather than by the caller over
        // the rows it receives. A blank line is skipped but still costs a number,
        // because the number's only job is to send somebody to that row in a file
        // of eight hundred megabytes -- and one counted downstream would name a
        // row one earlier for every blank line above it, which is a report that
        // is wrong in exactly the situation it was printed for.
        let line = 1;
        for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
          line += 1;
          if (next.value === '') {
            continue;
          }
          // A plain split, deliberately. The archive's own documentation states
          // that no field contains a comma or a double quote, so a quote-aware
          // parser here would be code defending against a case that cannot
          // occur -- and if it ever does, a row that splits into the wrong
          // number of cells fails the checks in `projectCorpusRow` rather than
          // publishing a shifted one.
          yield { line, cells: next.value.split(',') };
        }
      },
    },
  };
}

/** The five weights on a row, or the reason one of them was unreadable. */
function readWeights(read: (column: RequiredColumn) => string):
  | {
      readonly bodyweightKg: number | null;
      readonly squatKg: number | null;
      readonly benchKg: number | null;
      readonly deadliftKg: number | null;
      readonly totalKg: number | null;
    }
  | string {
  // Written out one at a time rather than looped over a table of column names.
  // A loop produces a record whose values are still `number | null |
  // 'malformed'` after the check, and the only way to hand that to an entry is a
  // cast -- which is exactly the construct that would go on compiling the day a
  // sixth weight was added to the loop and not to the check.
  const bodyweightKg = readKilograms(read('BodyweightKg'));
  if (bodyweightKg === 'malformed') {
    return 'BodyweightKg is neither blank nor a weight above zero';
  }
  const squatKg = readBestLift(read('Best3SquatKg'));
  if (squatKg === 'malformed') {
    return 'Best3SquatKg is neither blank, a weight above zero, nor a failed attempt';
  }
  const benchKg = readBestLift(read('Best3BenchKg'));
  if (benchKg === 'malformed') {
    return 'Best3BenchKg is neither blank, a weight above zero, nor a failed attempt';
  }
  const deadliftKg = readBestLift(read('Best3DeadliftKg'));
  if (deadliftKg === 'malformed') {
    return 'Best3DeadliftKg is neither blank, a weight above zero, nor a failed attempt';
  }
  const totalKg = readKilograms(read('TotalKg'));
  if (totalKg === 'malformed') {
    return 'TotalKg is neither blank nor a weight above zero';
  }
  return { bodyweightKg, squatKg, benchKg, deadliftKg, totalKg };
}

/**
 * A best-of-three, where a negative figure means the lifter failed the lift.
 *
 * The archive's own documentation: "Rarely may be negative: that is used by some
 * federations to report the lowest weight the lifter attempted and failed." So a
 * negative cell is not corrupt, it is a bomb-out written down, and it becomes
 * `null` -- no successful lift is recorded -- rather than a withheld row.
 *
 * That distinction is worth 3,099 entries on the measured corpus, and getting it
 * wrong is not a rounding error: withholding the row deletes a *whole meet* from
 * a lifter's history because they missed one lift at it. On a screen that says
 * what somebody has competed in, a meet they bombed the squat at and went on to
 * pull a lifetime deadlift is a meet that has to be there.
 *
 * Zero stays malformed. Nothing upstream documents it, and it is the one value
 * that would read as a successful lift of nothing.
 */
function readBestLift(value: string): number | null | 'malformed' {
  const parsed = Number(value);
  if (value !== '' && Number.isFinite(parsed) && parsed < 0) {
    return null;
  }
  return readKilograms(value);
}

/** A weight, `null` for a blank cell, or `'malformed'` for anything else. */
function readKilograms(value: string): number | null | 'malformed' {
  if (value === '') {
    return null;
  }
  const parsed = Number(value);
  // A blank cell is a missing figure and a zero is a lift of nothing. Coercing
  // the first into the second publishes a total every lifter beats.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 'malformed';
  }
  return parsed;
}

/**
 * An age, `null` for a blank cell, or `'malformed'` for anything else.
 *
 * A half year is the archive's way of saying it knows the birth year and not the
 * birth date, so the lifter was one of two ages on the day. See `AthleteAgeSchema`
 * for why that is kept rather than rounded away.
 */
function readAge(value: string): { years: number; approximate: boolean } | null | 'malformed' {
  if (value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'malformed';
  }
  const years = Math.floor(parsed);
  const remainder = parsed - years;
  if (remainder !== 0 && remainder !== 0.5) {
    return 'malformed';
  }
  return { years, approximate: remainder === 0.5 };
}

function blankToNull(value: string): string | null {
  return value === '' ? null : value;
}

/** Shares the low-cardinality strings of one entry with every other entry like it. */
function internEntry(entry: AthleteEntry, intern: (value: string) => string): AthleteEntry {
  return {
    ...entry,
    date: intern(entry.date),
    federation: intern(entry.federation),
    parentFederation: entry.parentFederation === null ? null : intern(entry.parentFederation),
    meetName: intern(entry.meetName),
    event: intern(entry.event),
    equipment: intern(entry.equipment),
    division: entry.division === null ? null : intern(entry.division),
    ageClass: entry.ageClass === null ? null : intern(entry.ageClass),
    sex: intern(entry.sex),
    weightClassKg: entry.weightClassKg === null ? null : intern(entry.weightClassKg),
    place: entry.place === null ? null : intern(entry.place),
  };
}

/**
 * Oldest first, and deterministic all the way down.
 *
 * Date alone leaves two entries at one meet in whatever order the archive
 * happened to list them, and a content-addressed artifact whose order can move
 * without its data changing is an artifact that gets a new filename for nothing.
 */
function compareEntries(left: AthleteEntry, right: AthleteEntry): number {
  return (
    compare(left.date, right.date) ||
    compare(left.meetName, right.meetName) ||
    compare(left.event, right.event) ||
    compare(left.equipment, right.equipment) ||
    compare(left.division ?? '', right.division ?? '') ||
    compare(String(left.totalKg ?? ''), String(right.totalKg ?? ''))
  );
}

/** Code-unit ordering, so the result does not depend on the build machine's locale. */
function compare(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/**
 * Withheld rows as counts per rule, with a few line numbers for each.
 *
 * Grouped rather than listed: at this scale one broken rule is tens of thousands
 * of rows, and the full list buries every other line of the build. The line
 * numbers are what somebody needs to go and look, and a name is what they must
 * never be given (section 2.3).
 */
export function summarizeWithheld(withheld: readonly WithheldEntryRow[]): string {
  const byReason = new Map<string, { count: number; lines: number[] }>();
  for (const row of withheld) {
    const seen = byReason.get(row.reason);
    if (seen === undefined) {
      byReason.set(row.reason, { count: 1, lines: [row.line] });
      continue;
    }
    seen.count += 1;
    if (seen.lines.length < 3) {
      seen.lines.push(row.line);
    }
  }

  return [...byReason]
    .sort(([, left], [, right]) => right.count - left.count)
    .slice(0, MAXIMUM_REPORTED)
    .map(([reason, seen]) => `${String(seen.count)} x ${reason} (lines ${seen.lines.join(', ')})`)
    .join('\n  ');
}
