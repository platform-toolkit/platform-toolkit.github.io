/**
 * The three questions that say *which records*, as distinct from who the lifter
 * is.
 *
 * Level, region and discipline are deliberately **not** part of
 * {@link CategorySelection}. Every field in that selection describes the lifter
 * -- their sex category, their equipment, their class, their division, whether
 * they compete tested -- and the classification screen is complete once all five
 * are answered. Adding three more would make it permanently incomplete for a
 * lifter who never scrolls to the records panel, and `resolveSelection`'s
 * `complete` flag is what the standards panel uses to decide whether it can pick
 * a table at all. So the axes that pick a *record book* live here instead, and
 * the two halves are combined only where a record is actually looked up.
 *
 * Pure, for the same reason `selection.ts` is: no DOM, no data source, no Lit.
 * The awkward cases -- a level with no regions, a discipline that does not
 * contest the deadlift, a region left over from the previous level -- are then
 * testable as data rather than through a rendered page.
 */
import type { CategoryCatalog, Lift } from '@platform-toolkit/data-contracts';
import type { Choice } from '@platform-toolkit/ui';

/** The questions, in the order they are asked. */
export type RecordScopeField = 'level' | 'region' | 'discipline';

/** What the lifter has chosen so far. `null` is "not answered yet". */
export type RecordScopeSelection = Readonly<Record<RecordScopeField, string | null>>;

export const NO_RECORD_SCOPE: RecordScopeSelection = {
  level: null,
  region: null,
  discipline: null,
};

/** One question, ready to hand to a choice group. */
export interface RecordScopeQuestion {
  readonly field: RecordScopeField;
  readonly label: string;
  readonly choices: readonly Choice[];
  /** The answer, after anything the catalogue does not offer has been dropped. */
  readonly value: string | null;
  /** Shown instead of the options when there are none. */
  readonly emptyMessage: string;
}

/**
 * The two axes that choose the published artifact.
 *
 * `regionId: null` here means the chosen level is not subdivided, which is a
 * settled answer -- there is one national record, not one per state. It never
 * means "the region question has not been answered yet": that case is the whole
 * partition being `null`. Collapsing the two would ask for the artifact of a
 * level's unsubdivided records the instant the level was picked, and the file
 * that came back would be the wrong one for any federation that does subdivide.
 */
export interface RecordPartition {
  readonly levelId: string;
  readonly regionId: string | null;
}

export interface ResolvedRecordScope {
  readonly questions: readonly RecordScopeQuestion[];
  /** The requested scope, minus anything this catalogue cannot offer. */
  readonly selection: RecordScopeSelection;
  /** Which artifact to read, or `null` while the level or its region is unanswered. */
  readonly partition: RecordPartition | null;
  /**
   * The lifts the chosen discipline contests, empty until one is chosen.
   *
   * Carried rather than assumed, because a bench-only meet holds no deadlift
   * record and no total. Showing four cards regardless would put "no record
   * stands in this category" under a lift the federation does not contest, which
   * reads as a gap in the data rather than as the rules.
   */
  readonly lifts: readonly Lift[];
  /** Every question answered, so a record book can be looked up. */
  readonly complete: boolean;
}

/**
 * Turns a catalogue and a request into the questions and the settled answers.
 *
 * Same discipline as `resolveSelection`: an answer the catalogue does not offer
 * is dropped rather than kept, so a lifter who picks a Texas state record, looks
 * at the national tables and comes back does not carry "Texas" into a level that
 * has no such region. The request is kept by the caller and re-resolved every
 * render, which is what restores the answer when they switch back.
 */
export function resolveRecordScope(
  catalog: CategoryCatalog,
  requested: RecordScopeSelection,
): ResolvedRecordScope {
  const questions: RecordScopeQuestion[] = [];

  const levelChoices = catalog.levels.map((level) => ({ value: level.id, label: level.label }));
  const levelId = offered(levelChoices, requested.level);
  questions.push({
    field: 'level',
    label: 'Record level',
    choices: levelChoices,
    value: levelId,
    emptyMessage: 'No record levels are published.',
  });

  const level = catalog.levels.find((candidate) => candidate.id === levelId) ?? null;

  // Asked only when the chosen level has regions. A level that is not
  // subdivided is not a level whose region question is empty -- it is a level
  // with no region question, and rendering an empty "Region" under "National"
  // reads as missing data when it is the correct and complete state.
  const regionId =
    level === null || level.regions.length === 0
      ? null
      : askRegion(questions, level.regions, requested.region);

  const disciplineChoices = catalog.disciplines.map((discipline) => ({
    value: discipline.id,
    label: discipline.label,
    description: liftList(discipline.lifts),
  }));
  const disciplineId = offered(disciplineChoices, requested.discipline);
  questions.push({
    field: 'discipline',
    label: 'Event',
    choices: disciplineChoices,
    value: disciplineId,
    emptyMessage: 'No events are published.',
  });

  const discipline = catalog.disciplines.find((candidate) => candidate.id === disciplineId);

  return {
    questions,
    // The region is reported as the resolver settled it, not as it was asked
    // for. A level with no regions answers `null` even if the request still
    // holds one, so a caller storing this back would not be able to tell the two
    // apart -- which is why the caller stores its own request instead.
    selection: { level: levelId, region: regionId, discipline: disciplineId },
    partition: partitionOf(level, regionId),
    lifts: discipline?.lifts ?? [],
    // Derived from the questions rather than from the three fields, so that a
    // level with no regions is complete without one and a question with no
    // answers can never be satisfied by vacuum.
    complete: questions.every((question) => question.value !== null),
  };
}

function askRegion(
  questions: RecordScopeQuestion[],
  regions: readonly { readonly id: string; readonly label: string }[],
  requested: string | null,
): string | null {
  const choices = regions.map((region) => ({ value: region.id, label: region.label }));
  const value = offered(choices, requested);
  questions.push({
    field: 'region',
    label: 'Region',
    choices,
    value,
    emptyMessage: 'No regions are published for this level.',
  });
  return value;
}

/** The requested answer if the catalogue offers it, `null` otherwise. */
function offered(choices: readonly Choice[], requested: string | null): string | null {
  return choices.some((choice) => choice.value === requested) ? requested : null;
}

/**
 * Which file to read, once the level and any region it needs are settled.
 *
 * A subdivided level with no region chosen is `null` rather than a partition
 * with `regionId: null`, because that partition exists and holds nothing -- the
 * publisher writes a record's own region, and a state record always has one. The
 * read would succeed, return no artifact, and the panel would say the federation
 * publishes no records for the category, which is a sentence nobody investigates.
 */
function partitionOf(
  level: CategoryCatalog['levels'][number] | null,
  regionId: string | null,
): RecordPartition | null {
  if (level === null) {
    return null;
  }
  if (level.regions.length === 0) {
    return { levelId: level.id, regionId: null };
  }
  return regionId === null ? null : { levelId: level.id, regionId };
}

/**
 * The lifts a discipline contests, as a second line under its name.
 *
 * "Bench only" says so in its label and "Full power" does not, and the ones in
 * between -- push-pull, ipf-style single lifts -- are named differently by every
 * federation. Printing what the catalogue actually says the event holds is how a
 * lifter picks the right one without knowing the local vocabulary.
 */
function liftList(lifts: readonly Lift[]): string {
  const labels = lifts.map((lift) => LIFT_NOUNS[lift]);
  if (labels.length <= 1) {
    return `Records in the ${labels.join('')}.`;
  }
  return `Records in the ${labels.slice(0, -1).join(', ')} and ${labels.slice(-1).join('')}.`;
}

/**
 * Lift names as they read inside a sentence.
 *
 * Lower case and separate from `LIFT_LABELS` in `standards.ts`, which titles a
 * field. "Records in the Bench press and Total" is a caption written by a
 * program; these are the same four words written by a person.
 */
const LIFT_NOUNS: Readonly<Record<Lift, string>> = {
  squat: 'squat',
  bench: 'bench press',
  deadlift: 'deadlift',
  total: 'total',
};
