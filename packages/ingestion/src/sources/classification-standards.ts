// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  ClassificationTableSchema,
  LiftSchema,
  SexCategorySchema,
  type CategoryCatalog,
  type ClassificationStandard,
  type ClassificationTable,
  type SourceFreshness,
} from '@platform-toolkit/data-contracts';
import { ClassificationLadder, parseKilograms } from '@platform-toolkit/domain';
import * as v from 'valibot';

/**
 * Turning a federation's published classification standards into tables.
 *
 * Unlike the categories, the standards are not transcribed. The federation
 * publishes them as a machine-readable table for its own calculator, so the file
 * is committed verbatim and this reads it. What is curated is the translation:
 * the published table names its axes in the federation's own words, and a
 * document beside it says what each of those means in terms of the identifiers
 * the rest of the application uses.
 *
 * Nothing in this file names a federation, and nothing in it knows that `Cl Raw`
 * means classic raw. That is data, and it lives in `data/sources/`.
 *
 * THE TWO FAILURES THIS GUARDS AGAINST
 *
 * A standard nobody can reach, and a mapping that no longer matches anything,
 * look identical on screen: the lifter is shown nothing, which is exactly how a
 * category the federation genuinely does not publish standards for looks. So
 * both directions are checked. Every axis value in the published table must be
 * mapped, and every mapping must match something -- the first catches a
 * federation adding a weight class, the second catches it removing one.
 *
 * The same reasoning covers the age divisions, from the other end. A division
 * the rulebook defines and the standards do not cover has to be listed and
 * explained, so that adding a division to the categories document forces a
 * decision rather than quietly producing a division with no standards in it.
 */

const NonEmpty = v.pipe(v.string(), v.minLength(1));

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
 * The committed copy of the published dataset, and the digest that pins it.
 *
 * A plain filename, not a path. The caller resolves it inside the snapshot
 * directory, and a name that could climb out of one never reaches that code.
 *
 * The digest is what makes refreshing the snapshot a deliberate act. Upstream
 * can add a weight class or renumber a grade, and the mapping beside it would
 * still parse; requiring the two to be updated together means somebody looked.
 */
const SnapshotReferenceSchema = v.object({
  // `check` rather than `regex`, because valibot reports the pattern itself as
  // the expectation and these messages are read by somebody editing the file.
  file: v.pipe(
    v.string(),
    v.check((value) => /^[a-z0-9][a-z0-9._-]*\.json$/u.test(value), 'a plain JSON filename'),
  ),
  sha256: v.pipe(
    v.string(),
    v.check((value) => /^[0-9a-f]{64}$/u.test(value), 'a lowercase hex sha-256 digest'),
  ),

  /**
   * Where the snapshot was downloaded from, or `null` if it was not downloaded.
   *
   * Required rather than optional, and explicitly `null` for a dataset that was
   * transcribed or exported by hand. `check:upstream` reports a `null` as
   * "manual" and a missing field as a fault; leaving it out would make an
   * unwatched source indistinguishable from one nobody has got round to
   * automating, which is the difference between a stale figure being noticed in
   * a week and being noticed by a lifter.
   */
  url: v.nullable(
    v.pipe(
      v.string(),
      v.url(),
      // `check:upstream` fetches this. It is committed and reviewed rather than
      // user-supplied, but the narrow rule costs nothing and means a typo that
      // downgrades the transport, or a credential pasted into the URL, is a
      // failed schema parse rather than a request that goes out anyway.
      v.check((value) => value.startsWith('https://'), 'an https URL'),
      v.check((value) => {
        const parsed = URL.parse(value);
        return parsed !== null && parsed.username === '' && parsed.password === '';
      }, 'a URL with no embedded credentials'),
    ),
  ),
});

/**
 * One grade, and the column it is published in.
 *
 * `rank` is carried rather than inferred from the figures, for the reason
 * `ClassificationStandard` gives: the two disagreeing is a fault to report, not
 * a tie to break silently.
 */
const GradeMappingSchema = v.object({
  column: NonEmpty,
  id: NonEmpty,
  label: NonEmpty,
  rank: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

const LiftMappingSchema = v.object({ event: NonEmpty, lift: LiftSchema, label: NonEmpty });
const EquipmentMappingSchema = v.object({ gear: NonEmpty, equipmentId: NonEmpty });
const SexMappingSchema = v.object({ gender: NonEmpty, sex: SexCategorySchema });

/** Keyed by sex as well as weight, because two ladders can share a number. */
const WeightClassMappingSchema = v.object({
  sex: SexCategorySchema,
  weight: NonEmpty,
  weightClassId: NonEmpty,
});

/** One published age band, and the divisions it applies to in full. */
const DivisionMappingSchema = v.object({
  age: NonEmpty,
  divisionIds: v.pipe(v.array(NonEmpty), v.minLength(1)),
});

const UnmappedDivisionSchema = v.object({ divisionId: NonEmpty, reason: NonEmpty });

/** One published row withheld on purpose, and why. */
const QuarantineSchema = v.object({
  gender: NonEmpty,
  gear: NonEmpty,
  event: NonEmpty,
  age: NonEmpty,
  weight: NonEmpty,
  reason: NonEmpty,
});

/**
 * The curated form of one federation's classification mapping.
 *
 * `$comment` keys are tolerated anywhere they appear and dropped rather than
 * published: JSON has no comments, and a mapping that cannot explain itself is
 * a mapping nobody dares change.
 */
export const ClassificationSourceDocumentSchema = v.object({
  id: NonEmpty,
  label: NonEmpty,
  provenance: ProvenanceSchema,
  standards: SnapshotReferenceSchema,
  /** `null` where the federation publishes one set of standards for everyone. */
  tested: v.nullable(v.boolean()),
  grades: v.pipe(v.array(GradeMappingSchema), v.minLength(1)),
  lifts: v.pipe(v.array(LiftMappingSchema), v.minLength(1)),
  equipment: v.pipe(v.array(EquipmentMappingSchema), v.minLength(1)),
  sexes: v.pipe(v.array(SexMappingSchema), v.minLength(1)),
  weightClasses: v.pipe(v.array(WeightClassMappingSchema), v.minLength(1)),
  divisions: v.pipe(v.array(DivisionMappingSchema), v.minLength(1)),
  unmappedDivisions: v.array(UnmappedDivisionSchema),
  quarantine: v.array(QuarantineSchema),
});
export type ClassificationSourceDocument = v.InferOutput<typeof ClassificationSourceDocumentSchema>;

/** The axis columns every published row carries, whatever else it carries. */
const AXIS_COLUMNS = ['age', 'event', 'weight', 'gear', 'gender'] as const;

/**
 * The published dataset, as it is served.
 *
 * Every figure arrives as a string, including the numbers. They are parsed
 * explicitly rather than coerced, so a malformed one is a reported failure and
 * not a `NaN` that reaches a lifter's screen as a blank.
 */
const SnapshotSchema = v.object({
  data: v.pipe(
    v.array(
      v.objectWithRest(
        {
          age: NonEmpty,
          event: NonEmpty,
          weight: NonEmpty,
          gear: NonEmpty,
          gender: NonEmpty,
        },
        v.string(),
      ),
    ),
    v.minLength(1),
  ),
});

type SnapshotRow = v.InferOutput<typeof SnapshotSchema>['data'][number];

/** The committed dataset and the digest of the bytes it was read from. */
export interface ClassificationSnapshot {
  readonly value: unknown;
  /** Lowercase hex sha-256 of the file's contents, computed by the caller. */
  readonly sha256: string;
}

/** A published row that was deliberately not published onward. */
export interface WithheldRow {
  /** The row's axis values, in the federation's own words. */
  readonly row: string;
  readonly reason: string;
}

export interface ClassificationSourceResult {
  readonly tables: readonly ClassificationTable[];
  readonly freshness: SourceFreshness;
  /** Rows excluded by the quarantine list. Worth logging; never silent. */
  readonly withheld: readonly WithheldRow[];
}

/**
 * Thrown when a mapping document or the dataset beside it is unusable.
 *
 * Carries every problem rather than the first. A mapping is edited by a person
 * working through a published table, and a build that surfaces one of four
 * mistakes costs four builds.
 */
export class ClassificationSourceError extends Error {
  override readonly name = 'ClassificationSourceError';

  constructor(readonly problems: readonly string[]) {
    super(`Classification source is unusable:\n  ${problems.join('\n  ')}`);
  }
}

/** What a caller has to know before it can supply the rest of the inputs. */
export interface ClassificationSourceReferences {
  /** Which federation's catalogue this mapping must be checked against. */
  readonly federationId: string;
  /** Which file in the snapshot directory holds the published standards. */
  readonly standardsFile: string;
  /** The digest that file has to have. */
  readonly standardsSha256: string;
  /** Where that file came from, or `null` if it was not downloaded. */
  readonly standardsUrl: string | null;
}

/**
 * Reads what a caller needs before it can call
 * {@link buildClassificationTables}: whose catalogue to fetch, and which file to
 * read and digest.
 *
 * This parses the document, and so does the build. Doing it twice costs
 * microseconds and keeps the build a single call taking the raw document, rather
 * than a two-step sequence every caller has to get in the right order.
 *
 * @throws {ClassificationSourceError} if the document does not parse.
 */
export function readClassificationSourceReferences(
  document: unknown,
): ClassificationSourceReferences {
  const source = parseDocument(document);
  return {
    federationId: source.id,
    standardsFile: source.standards.file,
    standardsSha256: source.standards.sha256,
    standardsUrl: source.standards.url,
  };
}

/**
 * Validates a mapping document against its dataset and builds every table.
 *
 * The catalogue is required, not optional: the mapping's whole job is to name
 * identifiers from it, and an identifier that does not exist there produces a
 * table no lookup will ever match.
 *
 * @throws {ClassificationSourceError} if anything does not line up.
 */
export function buildClassificationTables(
  document: unknown,
  snapshot: ClassificationSnapshot,
  catalog: CategoryCatalog,
): ClassificationSourceResult {
  const source = parseDocument(document);

  // Both of these make every later message noise, so they are reported alone.
  if (source.id !== catalog.id) {
    throw new ClassificationSourceError([
      `mapping is for federation "${source.id}" but was given the catalogue for "${catalog.id}"`,
    ]);
  }
  if (snapshot.sha256 !== source.standards.sha256) {
    throw new ClassificationSourceError([
      `standards: "${source.standards.file}" has digest ${snapshot.sha256}, but the mapping was ` +
        `written against ${source.standards.sha256}. Review the change, then update the digest.`,
    ]);
  }

  const rows = parseSnapshot(snapshot.value, source.standards.file);
  const problems: string[] = [];

  checkMappingsAreUnambiguous(problems, source);
  checkMappingsNameRealCategories(problems, source, catalog);
  checkEveryPublishedValueIsMapped(problems, source, rows);
  checkEveryDivisionIsAccountedFor(problems, source, catalog);

  if (problems.length > 0) {
    // Nothing below can say anything useful while the axes disagree.
    throw new ClassificationSourceError(problems);
  }

  const built = buildTables(problems, source, catalog, rows);
  if (problems.length > 0) {
    throw new ClassificationSourceError(problems);
  }

  // Against the contract the browser reads them with, not only against the
  // checks above: those are about meaning, and would happily pass a value that
  // had lost a required field on the way through this function.
  const validated = v.safeParse(v.array(ClassificationTableSchema), built.tables);
  if (!validated.success) {
    throw new ClassificationSourceError(
      validated.issues.map((issue) => `built tables: ${describeIssue(issue)}`),
    );
  }

  return {
    tables: validated.output,
    withheld: built.withheld,
    freshness: {
      id: source.provenance.id,
      label: `${source.provenance.label} (${source.provenance.document})`,
      retrievedAt: source.provenance.retrievedAt,
      // Always `ok`. The digest catches the file changing under us; it cannot
      // tell that the federation has published a revision we have not fetched.
      status: 'ok',
    },
  };
}

function parseDocument(document: unknown): ClassificationSourceDocument {
  const parsed = v.safeParse(ClassificationSourceDocumentSchema, document);
  if (parsed.success) {
    return parsed.output;
  }
  throw new ClassificationSourceError(parsed.issues.map(describeIssue));
}

function parseSnapshot(value: unknown, file: string): readonly SnapshotRow[] {
  const parsed = v.safeParse(SnapshotSchema, value);
  if (parsed.success) {
    return parsed.output.data;
  }
  throw new ClassificationSourceError(
    parsed.issues.map((issue) => `${file}: ${describeIssue(issue)}`),
  );
}

/**
 * Where a value failed and what was wanted there, never the value itself.
 *
 * A `check` action reports no `expected` and carries its wording in `message`
 * instead, so both are consulted. Every `check` in this file is given a message
 * for that reason: valibot's default one quotes the input it rejected, and these
 * documents will eventually carry figures alongside things that are not figures.
 */
function describeIssue(issue: v.BaseIssue<unknown>): string {
  return `${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected ?? issue.message}`;
}

/** Two mappings for one thing means the build has to guess. It does not guess. */
function checkMappingsAreUnambiguous(
  problems: string[],
  source: ClassificationSourceDocument,
): void {
  collectDuplicates(
    problems,
    'grade column',
    source.grades.map((grade) => grade.column),
  );
  collectDuplicates(
    problems,
    'grade identifier',
    source.grades.map((grade) => grade.id),
  );
  collectDuplicates(
    problems,
    'grade label',
    source.grades.map((grade) => grade.label),
  );
  collectDuplicates(
    problems,
    'grade rank',
    source.grades.map((grade) => String(grade.rank)),
  );

  collectDuplicates(
    problems,
    'lift event',
    source.lifts.map((entry) => entry.event),
  );
  collectDuplicates(
    problems,
    'lift',
    source.lifts.map((entry) => entry.lift),
  );
  collectDuplicates(
    problems,
    'equipment gear',
    source.equipment.map((entry) => entry.gear),
  );
  collectDuplicates(
    problems,
    'equipment identifier',
    source.equipment.map((entry) => entry.equipmentId),
  );
  collectDuplicates(
    problems,
    'sex',
    source.sexes.map((entry) => entry.gender),
  );
  collectDuplicates(
    problems,
    'weight class',
    source.weightClasses.map((entry) => `${entry.sex} ${entry.weight}`),
  );
  collectDuplicates(
    problems,
    'weight class identifier',
    source.weightClasses.map((entry) => entry.weightClassId),
  );
  collectDuplicates(
    problems,
    'age band',
    source.divisions.map((entry) => entry.age),
  );

  // A division named by two bands would be handed two sets of standards, and
  // the tables would collide rather than one of them winning.
  collectDuplicates(
    problems,
    'mapped division',
    source.divisions.flatMap((entry) => entry.divisionIds),
  );
  collectDuplicates(
    problems,
    'unmapped division',
    source.unmappedDivisions.map((entry) => entry.divisionId),
  );
}

/** Every identifier the mapping names has to exist in the catalogue. */
function checkMappingsNameRealCategories(
  problems: string[],
  source: ClassificationSourceDocument,
  catalog: CategoryCatalog,
): void {
  const equipmentIds = new Set(catalog.equipment.map((entry) => entry.id));
  for (const entry of source.equipment) {
    if (!equipmentIds.has(entry.equipmentId)) {
      problems.push(
        `equipment: gear "${entry.gear}" maps to "${entry.equipmentId}", which the catalogue does not define`,
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
      // written under a women's weight is the mistake worth naming precisely.
      problems.push(
        `weight classes: ${entry.sex} "${entry.weight}" maps to "${entry.weightClassId}", ` +
          `which is not in the ${entry.sex} ladder`,
      );
    }
  }

  const divisionIds = new Set(catalog.ageDivisions.divisions.map((division) => division.id));
  for (const entry of source.divisions) {
    for (const divisionId of entry.divisionIds) {
      if (!divisionIds.has(divisionId)) {
        problems.push(
          `divisions: age band "${entry.age}" maps to "${divisionId}", which the catalogue does not define`,
        );
      }
    }
  }
  for (const entry of source.unmappedDivisions) {
    if (!divisionIds.has(entry.divisionId)) {
      problems.push(
        `unmapped divisions: "${entry.divisionId}" is not a division the catalogue defines`,
      );
    }
  }
}

/**
 * Every value the dataset publishes has to be mapped, and every mapping used.
 *
 * Distinct values are collected before anything is reported, because one
 * unmapped equipment category appears in a quarter of several thousand rows and
 * would otherwise bury every other problem in the list.
 */
function checkEveryPublishedValueIsMapped(
  problems: string[],
  source: ClassificationSourceDocument,
  rows: readonly SnapshotRow[],
): void {
  const published = {
    gender: new Set<string>(),
    event: new Set<string>(),
    gear: new Set<string>(),
    age: new Set<string>(),
    weightBySex: new Set<string>(),
    columns: new Set<string>(),
  };

  const sexByGender = new Map(source.sexes.map((entry) => [entry.gender, entry.sex]));
  const axisColumns = new Set<string>(AXIS_COLUMNS);

  for (const row of rows) {
    published.gender.add(row.gender);
    published.event.add(row.event);
    published.gear.add(row.gear);
    published.age.add(row.age);
    const sex = sexByGender.get(row.gender);
    if (sex !== undefined) {
      published.weightBySex.add(`${sex} ${row.weight}`);
    }
    for (const column of Object.keys(row)) {
      if (!axisColumns.has(column)) {
        published.columns.add(column);
      }
    }
  }

  compareBothWays(problems, 'sex', published.gender, new Set(sexByGender.keys()));
  compareBothWays(
    problems,
    'lift event',
    published.event,
    new Set(source.lifts.map((entry) => entry.event)),
  );
  compareBothWays(
    problems,
    'equipment gear',
    published.gear,
    new Set(source.equipment.map((entry) => entry.gear)),
  );
  compareBothWays(
    problems,
    'age band',
    published.age,
    new Set(source.divisions.map((entry) => entry.age)),
  );
  compareBothWays(
    problems,
    'grade column',
    published.columns,
    new Set(source.grades.map((grade) => grade.column)),
  );

  // Weight classes are checked only once the sexes line up; otherwise every
  // class of an unmapped sex is reported as missing as well.
  if (published.gender.size === sexByGender.size) {
    compareBothWays(
      problems,
      'weight class',
      published.weightBySex,
      new Set(source.weightClasses.map((entry) => `${entry.sex} ${entry.weight}`)),
    );
  }
}

/**
 * Every division the rulebook defines is either covered or explained.
 *
 * The check that earns its keep is the second half. Adding a division to the
 * categories document is easy and produces, by default, a division with no
 * standards and no explanation -- indistinguishable on screen from one the
 * federation deliberately does not publish standards for.
 */
function checkEveryDivisionIsAccountedFor(
  problems: string[],
  source: ClassificationSourceDocument,
  catalog: CategoryCatalog,
): void {
  const mapped = new Set(source.divisions.flatMap((entry) => entry.divisionIds));
  const explained = new Set(source.unmappedDivisions.map((entry) => entry.divisionId));

  for (const division of catalog.ageDivisions.divisions) {
    const isMapped = mapped.has(division.id);
    const isExplained = explained.has(division.id);
    if (!isMapped && !isExplained) {
      problems.push(
        `divisions: "${division.id}" is neither mapped to an age band nor listed in ` +
          'unmappedDivisions with a reason',
      );
    }
    if (isMapped && isExplained) {
      problems.push(
        `divisions: "${division.id}" is both mapped to an age band and listed as unmapped`,
      );
    }
  }
}

interface BuiltTables {
  readonly tables: readonly ClassificationTable[];
  readonly withheld: readonly WithheldRow[];
}

/**
 * Expands every published row into one table per division it covers.
 *
 * Expanding here rather than publishing a band and translating it in the browser
 * keeps the lookup a plain match on a division identifier. A band is a fact
 * about how the federation prints its table, not a concept a reader should have
 * to hold.
 */
function buildTables(
  problems: string[],
  source: ClassificationSourceDocument,
  catalog: CategoryCatalog,
  rows: readonly SnapshotRow[],
): BuiltTables {
  const sexByGender = new Map(source.sexes.map((entry) => [entry.gender, entry.sex]));
  const liftByEvent = new Map(source.lifts.map((entry) => [entry.event, entry]));
  const equipmentByGear = new Map(source.equipment.map((entry) => [entry.gear, entry.equipmentId]));
  const weightClassByKey = new Map(
    source.weightClasses.map((entry) => [`${entry.sex} ${entry.weight}`, entry.weightClassId]),
  );
  const divisionsByAge = new Map(source.divisions.map((entry) => [entry.age, entry.divisionIds]));
  const gradesByRank = [...source.grades].sort((left, right) => left.rank - right.rank);
  const labels = buildLabelLookup(catalog);

  const quarantined = new Map(source.quarantine.map((entry) => [rowKey(entry), entry]));
  const usedQuarantine = new Set<string>();
  const seenRows = new Set<string>();
  const tables: ClassificationTable[] = [];
  const withheld: WithheldRow[] = [];
  const tableIds = new Set<string>();

  for (const row of rows) {
    const key = rowKey(row);
    if (seenRows.has(key)) {
      // Two rows for one combination. The calculator this data drives takes the
      // first match, so the second is unreachable and one of them is wrong.
      problems.push(`${key}: appears more than once`);
      continue;
    }
    seenRows.add(key);

    // Every lookup below is total: coverage was established before this ran.
    const sex = sexByGender.get(row.gender);
    const lift = liftByEvent.get(row.event);
    const equipmentId = equipmentByGear.get(row.gear);
    const divisionIds = divisionsByAge.get(row.age);
    if (
      sex === undefined ||
      lift === undefined ||
      equipmentId === undefined ||
      divisionIds === undefined
    ) {
      problems.push(`${key}: an axis value lost its mapping between checking and building`);
      continue;
    }
    const weightClassId = weightClassByKey.get(`${sex} ${row.weight}`);
    if (weightClassId === undefined) {
      problems.push(`${key}: weight "${row.weight}" has no ${sex} class`);
      continue;
    }

    const standards = readStandards(problems, key, row, gradesByRank);
    if (standards === null) {
      continue;
    }

    // The same check the browser will apply, applied where it can be fixed. A
    // ladder whose grades do not ascend cannot be read: it would tell a lifter
    // their next grade is one they have to skip a rank to reach.
    const built = ClassificationLadder.from(standards);
    const entry = quarantined.get(key);

    if (entry !== undefined) {
      usedQuarantine.add(key);
      if (built.ok) {
        // Upstream corrected it. Suppressing a row that had become good is the
        // quieter of the two failures and the one worth failing the build for.
        problems.push(
          `${key}: is quarantined but its grades now ascend. Remove the entry: "${entry.reason}"`,
        );
        continue;
      }
      withheld.push({ row: key, reason: entry.reason });
      continue;
    }

    if (!built.ok) {
      problems.push(
        `${key}: ${built.problems.map((problem) => problem.message).join(' ')} ` +
          'Quarantine the row with a reason, or correct the mapping.',
      );
      continue;
    }

    for (const divisionId of divisionIds) {
      const id = [source.id, sex, lift.lift, equipmentId, weightClassId, divisionId].join('-');
      if (tableIds.has(id)) {
        problems.push(`${id}: two published rows produce this table`);
        continue;
      }
      tableIds.add(id);
      tables.push({
        id,
        label: [
          labels.ladder.get(sex) ?? sex,
          `${labels.equipment.get(equipmentId) ?? equipmentId} ${lift.label}`,
          labels.weightClass.get(weightClassId) ?? weightClassId,
          labels.division.get(divisionId) ?? divisionId,
        ].join(', '),
        scope: {
          sex,
          lift: lift.lift,
          equipmentId,
          weightClassId,
          divisionId,
          tested: source.tested,
        },
        // Already ascending: `ClassificationLadder` orders by rank on the way in.
        standards: [...built.ladder.standards],
      });
    }
  }

  for (const [key, entry] of quarantined) {
    if (!usedQuarantine.has(key)) {
      problems.push(
        `${key}: is quarantined but no such row is published. Remove the entry: "${entry.reason}"`,
      );
    }
  }

  // Sorted by identifier rather than left in publication order. Artifacts are
  // content-addressed, so a source that reordered its rows without changing any
  // of them would otherwise rewrite every filename and evict a cache that was
  // still correct.
  return { tables: tables.sort((left, right) => compare(left.id, right.id)), withheld };
}

/**
 * Reads one row's figures, or `null` if any of them is not a usable weight.
 *
 * Every figure in the published dataset is a string. The calculator it was
 * written for relies on implicit coercion; parsing explicitly means a malformed
 * figure is a named failure rather than a blank on a lifter's screen.
 */
function readStandards(
  problems: string[],
  key: string,
  row: SnapshotRow,
  gradesByRank: readonly v.InferOutput<typeof GradeMappingSchema>[],
): ClassificationStandard[] | null {
  const standards: ClassificationStandard[] = [];
  let usable = true;

  for (const grade of gradesByRank) {
    const raw = row[grade.column];
    if (raw === undefined) {
      problems.push(`${key}: has no "${grade.column}" figure`);
      usable = false;
      continue;
    }
    const parsed = parseKilograms(raw);
    if (!parsed.ok) {
      problems.push(`${key}: "${grade.column}" ${parsed.reason}`);
      usable = false;
      continue;
    }
    if (parsed.kilograms <= 0) {
      problems.push(`${key}: "${grade.column}" is not a weight above zero`);
      usable = false;
      continue;
    }
    standards.push({
      id: grade.id,
      label: grade.label,
      rank: grade.rank,
      requiredKilograms: parsed.kilograms,
    });
  }

  return usable ? standards : null;
}

interface LabelLookup {
  readonly ladder: ReadonlyMap<string, string>;
  readonly equipment: ReadonlyMap<string, string>;
  readonly weightClass: ReadonlyMap<string, string>;
  readonly division: ReadonlyMap<string, string>;
}

/**
 * The captions a table's own label is assembled from.
 *
 * Taken from the catalogue rather than restated in the mapping, so that a class
 * boundary and the words beside it cannot come to disagree.
 */
function buildLabelLookup(catalog: CategoryCatalog): LabelLookup {
  return {
    ladder: new Map(catalog.weightClassLadders.map((ladder) => [ladder.sex, ladder.label])),
    equipment: new Map(catalog.equipment.map((entry) => [entry.id, entry.label])),
    weightClass: new Map(
      catalog.weightClassLadders.flatMap((ladder) =>
        ladder.classes.map((weightClass) => [weightClass.id, weightClass.label] as const),
      ),
    ),
    division: new Map(
      catalog.ageDivisions.divisions.map((division) => [division.id, division.label]),
    ),
  };
}

/** A published row, named the way the federation names it. */
function rowKey(row: {
  gender: string;
  gear: string;
  event: string;
  age: string;
  weight: string;
}): string {
  return [row.gender, row.gear, row.event, row.age, row.weight].join(' / ');
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
      problems.push(`${what}: the published data uses "${value}", which nothing maps`);
    }
  }
  for (const value of [...mapped].sort(compare)) {
    if (!published.has(value)) {
      problems.push(`${what}: "${value}" is mapped but the published data never uses it`);
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

/** Code-unit ordering, so the result does not depend on the build machine's locale. */
function compare(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
