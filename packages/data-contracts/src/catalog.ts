import * as v from 'valibot';

import {
  AgeDivisionSetSchema,
  CompetitionLevelSchema,
  DisciplineSchema,
  EquipmentCategorySchema,
  WeightClassLadderSchema,
} from './categories.js';
import { slugSegment } from './artifact-naming.js';

/**
 * Everything a lifter has to choose before any other question can be asked.
 *
 * Equipment, weight classes, and divisions arrive as one artifact rather than
 * three. They are needed together on the very first paint -- the manual path
 * cannot render a single control without all of them -- and they are small,
 * measured in kilobytes against a 2 MiB budget. Splitting them would be three
 * round trips on a conference-centre network to draw one screen, which is the
 * opposite of what the sharding in `record-shards.ts` is for.
 *
 * Records are not in here and must not be. Those are the hundreds of thousands
 * of rows the budget exists to keep off a phone.
 *
 * A catalogue is per federation, because the whole point of it being data is
 * that two federations disagree: about what raw means, about where the class
 * boundaries fall, and about whether a lifter's age is read on the meet date or
 * across the calendar year.
 */

const Identifier = v.pipe(v.string(), v.minLength(1));
const Label = v.pipe(v.string(), v.minLength(1));

/** Prefix every catalogue artifact identifier carries. */
const CATALOG_ARTIFACT_PREFIX = 'categories';

export const CategoryCatalogSchema = v.object({
  id: Identifier,
  label: Label,

  /** The equipment categories this federation competes in. */
  equipment: v.pipe(v.array(EquipmentCategorySchema), v.minLength(1)),

  /**
   * One ladder per sex category.
   *
   * A list rather than a map keyed by sex, so that the published shape does not
   * have to change the day a source publishes a category this project's
   * `SexCategorySchema` does not yet name. Selecting the right one is the
   * reader's job and is a filter, not a lookup that can fail structurally.
   */
  weightClassLadders: v.pipe(v.array(WeightClassLadderSchema), v.minLength(1)),

  /** The divisions, and the basis their ages are read on. */
  ageDivisions: AgeDivisionSetSchema,

  /**
   * The levels records are kept at, and the regions each is divided into.
   *
   * In the catalogue rather than the record artifact because choosing a level and
   * a region is what decides *which* record artifact to fetch: records are
   * partitioned on exactly those two axes. A vocabulary published inside a
   * partition could only be read by somebody who already knew which partition
   * they wanted.
   */
  levels: v.pipe(v.array(CompetitionLevelSchema), v.minLength(1)),

  /**
   * The events the federation contests, and which lifts each holds records in.
   *
   * Here for the same reason the levels are: a lifter picks a discipline on the
   * way to a record, and the pick has to be renderable before anything has been
   * fetched.
   */
  disciplines: v.pipe(v.array(DisciplineSchema), v.minLength(1)),
});

export type CategoryCatalog = v.InferOutput<typeof CategoryCatalogSchema>;

/**
 * Names the artifact holding one federation's catalogue.
 *
 * Returns `null` when the identifier contains nothing that can appear in a
 * filename. Total for the same reason `recordArtifactId` is: the browser calls
 * it on the way to deciding whether an artifact exists, and "there is no such
 * file" is an answer it already knows how to render.
 */
export function categoryCatalogArtifactId(federationId: string): string | null {
  const federation = slugSegment(federationId);
  return federation === null ? null : `${CATALOG_ARTIFACT_PREFIX}-${federation}`;
}
