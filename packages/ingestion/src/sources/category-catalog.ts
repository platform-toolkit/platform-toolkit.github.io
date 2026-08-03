// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  AgeBasisSchema,
  CategoryCatalogSchema,
  LiftSchema,
  SexCategorySchema,
  type CategoryCatalog,
  type SourceFreshness,
  type WeightClass,
} from '@platform-toolkit/data-contracts';
import * as v from 'valibot';

/**
 * Turning a curated category document into the catalogue the browser reads.
 *
 * Nothing in this file names a federation. The document does, and the document
 * is data -- see `data/sources/`. What lives here is the part that is true of
 * every federation: which shapes are acceptable, which combinations are not,
 * and how a boundary becomes the caption a lifter reads beside it.
 *
 * Pure, like everything else that decides something in this package. The caller
 * reads the file; this takes the parsed value and returns the catalogue plus the
 * freshness entry describing where it came from.
 *
 * WHY THE INVARIANTS ARE HERE AND NOT IN THE CONTRACT
 *
 * `CategoryCatalogSchema` is what the browser validates a downloaded artifact
 * with, and it is deliberately structural: it will accept a ladder whose classes
 * descend, or two ladders for one sex, because those are not shapes -- they are
 * mistakes in the data. The browser cannot do anything useful about either one
 * at read time. A build can, so the checks belong on the way in, where the
 * failure names the file someone has to edit.
 *
 * Every problem is reported at once. A transcription is edited in a text editor
 * by a person working through a rulebook, and a build that surfaces the first
 * of four typos costs four builds.
 */

/**
 * A weight class as it is curated: an upper bound and a name for it.
 *
 * There is no label. A label and a boundary written side by side are two
 * statements of one fact, and the day someone edits `140` to `145` and leaves
 * "140 kg" beside it, the screen and the data disagree with nothing to catch it.
 * So the caption is derived below and cannot drift.
 *
 * The identifier is *not* derived, for the opposite reason: it keys records and
 * classification standards, so it has to survive the boundary moving. Deriving
 * it from the number would silently orphan every record under a class whose
 * limit changed by half a kilogram.
 */
const SourceWeightClassSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  /** `null` for the unbounded top class. */
  maximumKilograms: v.nullable(
    v.pipe(
      v.number(),
      v.finite(),
      v.check((kilograms) => kilograms > 0, 'a weight above zero'),
    ),
  ),
});

const SourceLadderSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  sex: SexCategorySchema,
  classes: v.pipe(v.array(SourceWeightClassSchema), v.minLength(1)),
});

const SourceAgeDivisionSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  minimumAge: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
  maximumAge: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

/**
 * A level records are kept at, and the regions it is divided into.
 *
 * `regions` is required and may be empty, unlike everything else optional-looking
 * in this file. "This level has no subdivisions" is a statement the transcriber
 * makes; an absent key would be indistinguishable from one they forgot, and the
 * difference is fifty state record books silently becoming one national one.
 */
const SourceRegionSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
});

const SourceLevelSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  regions: v.array(SourceRegionSchema),
});

const SourceDisciplineSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  lifts: v.pipe(v.array(LiftSchema), v.minLength(1)),
});

/**
 * Where a transcription came from and when.
 *
 * `retrievedAt` is the date the document was read, not the date the build ran.
 * Stamping the build time here would report a five-year-old transcription as
 * current every night, which is the one thing a freshness field must never do.
 */
const ProvenanceSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  /** The upstream document, named as it names itself. */
  document: v.pipe(v.string(), v.minLength(1)),
  url: v.pipe(v.string(), v.url()),
  /** Which parts of it were read. For the next person, not for publication. */
  sections: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1)),
  retrievedAt: v.pipe(v.string(), v.isoTimestamp()),
});

/**
 * The curated form of one federation's categories.
 *
 * `$comment` keys are tolerated anywhere they appear: JSON has no comments, and
 * a transcription that cannot explain itself is a transcription nobody dares
 * change. They are dropped rather than published.
 */
export const CategorySourceDocumentSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  provenance: ProvenanceSchema,
  equipment: v.pipe(
    v.array(
      v.object({
        id: v.pipe(v.string(), v.minLength(1)),
        label: v.pipe(v.string(), v.minLength(1)),
      }),
    ),
    v.minLength(1),
  ),
  weightClassLadders: v.pipe(v.array(SourceLadderSchema), v.minLength(1)),
  ageDivisions: v.object({
    id: v.pipe(v.string(), v.minLength(1)),
    label: v.pipe(v.string(), v.minLength(1)),
    basis: AgeBasisSchema,
    divisions: v.pipe(v.array(SourceAgeDivisionSchema), v.minLength(1)),
  }),
  levels: v.pipe(v.array(SourceLevelSchema), v.minLength(1)),
  disciplines: v.pipe(v.array(SourceDisciplineSchema), v.minLength(1)),
});

export type CategorySourceDocument = v.InferOutput<typeof CategorySourceDocumentSchema>;

/**
 * Thrown when a curated document is unusable.
 *
 * Carries every problem rather than the first, and quotes identifiers and
 * numbers freely: a federation's published class boundaries are public, and the
 * person reading this log is the person who has to find the line.
 */
export class CategorySourceError extends Error {
  override readonly name = 'CategorySourceError';

  constructor(readonly problems: readonly string[]) {
    super(`Category source document is unusable:\n  ${problems.join('\n  ')}`);
  }
}

export interface CategorySourceResult {
  readonly catalog: CategoryCatalog;
  readonly freshness: SourceFreshness;
}

/**
 * Validates a curated document and produces the catalogue and its freshness entry.
 *
 * @throws {CategorySourceError} if the document does not parse, or parses but
 *   describes categories that could not be presented to a lifter.
 */
export function buildCategoryCatalog(document: unknown): CategorySourceResult {
  const parsed = v.safeParse(CategorySourceDocumentSchema, document);
  if (!parsed.success) {
    throw new CategorySourceError(
      parsed.issues.map(
        (issue) => `${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
      ),
    );
  }
  const source = parsed.output;
  const problems: string[] = [];

  collectDuplicates(
    problems,
    'equipment category',
    source.equipment.map((category) => category.id),
    source.equipment.map((category) => category.label),
  );

  // Across every ladder, not within one. Two ladders that each contain `m-90`
  // would make a record for one reachable through the other, and a lifter would
  // be shown a number nobody in their category has lifted.
  const classIds: string[] = [];
  const sexes = new Set<string>();
  for (const ladder of source.weightClassLadders) {
    if (sexes.has(ladder.sex)) {
      // The interface asks one weight-class question per sex and has no way to
      // choose between two answers to it, so it reports the ambiguity and asks
      // nothing. Better to fail the build than publish a question that cannot
      // be answered.
      problems.push(`weight class ladders: ${ladder.sex} has more than one ladder`);
    }
    sexes.add(ladder.sex);
    classIds.push(...ladder.classes.map((weightClass) => weightClass.id));
  }
  collectDuplicates(
    problems,
    'weight class ladder',
    source.weightClassLadders.map((ladder) => ladder.id),
    source.weightClassLadders.map((ladder) => ladder.label),
  );
  collectDuplicates(problems, 'weight class', classIds, undefined);

  const ladders = source.weightClassLadders.map((ladder) => ({
    id: ladder.id,
    label: ladder.label,
    sex: ladder.sex,
    classes: buildLadderClasses(problems, ladder.id, ladder.classes),
  }));

  collectDuplicates(
    problems,
    'age division',
    source.ageDivisions.divisions.map((division) => division.id),
    source.ageDivisions.divisions.map((division) => division.label),
  );
  for (const division of source.ageDivisions.divisions) {
    if (
      division.minimumAge !== null &&
      division.maximumAge !== null &&
      division.minimumAge > division.maximumAge
    ) {
      problems.push(
        `age division "${division.id}": ${String(division.minimumAge)} to ` +
          `${String(division.maximumAge)} admits nobody`,
      );
    }
  }

  collectDuplicates(
    problems,
    'record level',
    source.levels.map((level) => level.id),
    source.levels.map((level) => level.label),
  );
  for (const level of source.levels) {
    // Within a level rather than across all of them. A region identifier is only
    // ever read under a level, so two levels may each have an "east"; two regions
    // called "east" under one level are a question with two identical answers.
    collectDuplicates(
      problems,
      `regions of level "${level.id}"`,
      level.regions.map((region) => region.id),
      level.regions.map((region) => region.label),
    );
  }

  collectDuplicates(
    problems,
    'discipline',
    source.disciplines.map((discipline) => discipline.id),
    source.disciplines.map((discipline) => discipline.label),
  );
  for (const discipline of source.disciplines) {
    collectDuplicates(
      problems,
      `lifts of discipline "${discipline.id}"`,
      discipline.lifts,
      undefined,
    );

    // A total is the sum of the three lifts, so a discipline that holds one must
    // contest all three. Without this a bench-only book can declare a total, and
    // the screen reports a lifter's bench as their three-lift total -- a number
    // that is plausible, wrong, and attributed to the federation.
    if (discipline.lifts.includes('total')) {
      const missing = (['squat', 'bench', 'deadlift'] as const).filter(
        (lift) => !discipline.lifts.includes(lift),
      );
      if (missing.length > 0) {
        problems.push(
          `discipline "${discipline.id}": holds a total but does not contest ${missing.join(', ')}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new CategorySourceError(problems);
  }

  const candidate = {
    id: source.id,
    label: source.label,
    equipment: source.equipment,
    weightClassLadders: ladders,
    ageDivisions: {
      id: source.ageDivisions.id,
      label: source.ageDivisions.label,
      basis: source.ageDivisions.basis,
      divisions: source.ageDivisions.divisions,
    },
    levels: source.levels,
    disciplines: source.disciplines,
  };

  // Against the contract the browser reads it with, here rather than only in
  // `planPublication`. The checks above are about meaning and would happily pass
  // a value that had lost a required field on the way through this function.
  const catalog = v.safeParse(CategoryCatalogSchema, candidate);
  if (!catalog.success) {
    throw new CategorySourceError(
      catalog.issues.map(
        (issue) =>
          `built catalogue: ${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
      ),
    );
  }

  return {
    catalog: catalog.output,
    freshness: {
      id: source.provenance.id,
      // The upstream document is named in the label because `SourceFreshness`
      // has nowhere else to put it, and "current as of March" means little
      // without "of which rulebook".
      label: `${source.provenance.label} (${source.provenance.document})`,
      retrievedAt: source.provenance.retrievedAt,
      // Always `ok`. A transcription cannot detect that its rulebook has been
      // superseded; until something upstream is watched, claiming to know would
      // be worse than the plain date.
      status: 'ok',
    },
  };
}

/**
 * Checks a ladder ascends and ends open, and derives each class's caption.
 *
 * Both properties are about a lifter who cannot be placed. A ladder that
 * descends puts two classes in the wrong order on screen and makes "the next
 * class up" wrong. A ladder whose last class is bounded has no home for anyone
 * above it -- they simply do not appear, which reads as a lifter with no
 * eligible class rather than as a data error.
 */
function buildLadderClasses(
  problems: string[],
  ladderId: string,
  classes: readonly v.InferOutput<typeof SourceWeightClassSchema>[],
): WeightClass[] {
  const built: WeightClass[] = [];
  let previousBound: number | null = null;

  for (const [index, weightClass] of classes.entries()) {
    const isLast = index === classes.length - 1;

    if (weightClass.maximumKilograms === null) {
      if (!isLast) {
        problems.push(
          `ladder "${ladderId}": class "${weightClass.id}" is unbounded but is not the last class`,
        );
      }
      if (previousBound === null) {
        // "Over nothing" has no caption, and a ladder of one open class is not
        // a ladder -- every lifter is in it and the question is pointless.
        problems.push(`ladder "${ladderId}": the unbounded class has no bounded class below it`);
      }
      built.push({
        id: weightClass.id,
        label: previousBound === null ? 'Unlimited' : `${String(previousBound)}+ kg`,
        maximumKilograms: null,
      });
      continue;
    }

    if (previousBound !== null && weightClass.maximumKilograms <= previousBound) {
      problems.push(
        `ladder "${ladderId}": class "${weightClass.id}" at ${String(weightClass.maximumKilograms)} kg ` +
          `does not exceed the class below it at ${String(previousBound)} kg`,
      );
    }
    if (isLast) {
      problems.push(
        `ladder "${ladderId}": the heaviest class is bounded at ` +
          `${String(weightClass.maximumKilograms)} kg, so a heavier lifter has no class`,
      );
    }

    built.push({
      id: weightClass.id,
      // `String` on a number from JSON gives "44" and "67.5" without a format
      // string, and without the trailing zero a fixed precision would add to
      // every whole-numbered class.
      label: `${String(weightClass.maximumKilograms)} kg`,
      maximumKilograms: weightClass.maximumKilograms,
    });
    previousBound = weightClass.maximumKilograms;
  }

  return built;
}

/**
 * Records duplicate identifiers, and duplicate labels where they matter.
 *
 * The two failures look nothing alike. A duplicate identifier is a data bug that
 * makes one row unreachable. A duplicate label builds a screen offering the same
 * words twice -- valid, publishable, and impossible to answer, which is exactly
 * the shape a rulebook printing five divisions called "Junior" arrives in.
 */
function collectDuplicates(
  problems: string[],
  what: string,
  ids: readonly string[],
  labels: readonly string[] | undefined,
): void {
  for (const duplicate of repeated(ids)) {
    problems.push(`${what}: identifier "${duplicate}" is used more than once`);
  }
  if (labels !== undefined) {
    for (const duplicate of repeated(labels)) {
      problems.push(`${what}: label "${duplicate}" is used more than once`);
    }
  }
}

function repeated(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}
