/**
 * Turns a published catalogue into the questions the tool asks, and keeps the
 * answers honest as they change.
 *
 * This is the half of the selection interface that knows what an option *means*
 * -- that a weight class belongs to one sex's ladder, that a division has an age
 * band, that a level is or is not subdivided into regions -- which is why it
 * lives in the tool rather than in `packages/ui`. It is pure: no DOM, no data
 * source, no Lit. The component below it decides how the questions look; this
 * decides what they are.
 *
 * The rule worth stating outright is that an answer the catalogue does not offer
 * is not an answer. `resolveSelection` drops it rather than keeping it. Without
 * that, a lifter who picks the 56 kg class and then corrects their sex category
 * keeps a class from the other ladder, and every number downstream -- records,
 * classification standards, qualifying totals -- is drawn from a category they
 * are not in. Nothing about the screen would look wrong.
 *
 * WHY THE RECORD AXES LIVE HERE NOW
 *
 * They used to live in a separate `record-scope.ts`, which asked a level, a
 * region and an event, and the argument for keeping them apart was that
 * `complete` gated the classification panel: a lifter who never scrolled to the
 * records would have left the category permanently incomplete. Both halves of
 * that are gone. The report shows every event (so there is no event question),
 * it resolves every unsubdivided level unconditionally (so there is no level
 * question), and what gates it is {@link ResolvedSelection.ready} -- sex,
 * equipment, one weight class and tested -- which no optional question can hold
 * up. What is left of the record scope is a single optional region picker, and
 * folding it in retires a real hazard: two events meant a watcher that had to
 * keep its own copy of each axis, because reading them back off the element
 * returned the values from before the event that woke it.
 *
 * WHAT IS OPTIONAL, AND WHY THAT IS THE POINT
 *
 * Four of the seven fields are optional and every one of them only *adds* to the
 * report. An age division adds its own rows beside the Open ones, which are
 * always there. A region adds that region's records to the levels that are
 * always there. A second weight class adds a column to compare against. None of
 * them can take anything away, so a lifter who answers nothing beyond the four
 * required questions still gets the whole report for their category -- which is
 * the tool's actual job, and used to be five questions away.
 */
import type {
  AgeDivision,
  CategoryCatalog,
  CompetitionLevel,
  Discipline,
  SexCategory,
  WeightClass,
} from '@platform-toolkit/data-contracts';
import { openAgeDivision } from '@platform-toolkit/domain';
import type { Choice, SelectOption } from '@platform-toolkit/ui';

/** Every answer the screen collects. */
export type SelectionField =
  'sex' | 'equipment' | 'weightClass' | 'comparisonWeightClass' | 'division' | 'tested' | 'region';

/** What the lifter has chosen so far. `null` is "not answered yet". */
export type CategorySelection = Readonly<Record<SelectionField, string | null>>;

export const NO_SELECTION: CategorySelection = {
  sex: null,
  equipment: null,
  weightClass: null,
  comparisonWeightClass: null,
  division: null,
  tested: null,
  region: null,
};

/**
 * The four answers a report cannot be drawn without.
 *
 * Listed once, here, rather than spelled out in the readiness check and again in
 * the sentence that says what is still missing. Two lists is how a screen ends
 * up naming a question it no longer waits for.
 */
export const REQUIRED_FIELDS: readonly SelectionField[] = [
  'sex',
  'equipment',
  'weightClass',
  'tested',
];

/**
 * The two answers to the drug-tested question, as the scope contract models it.
 *
 * A closed pair rather than published data, for the same reason the sex
 * categories are: `tested` is a `boolean | null` on every scope in
 * `data-contracts`, so these are the only two things a lifter can be. The
 * `null` on a scope means something else entirely -- "the source does not
 * distinguish" -- and is never an answer a lifter gives.
 */
export const TESTED_VALUES = ['tested', 'untested'] as const;
export type TestedValue = (typeof TESTED_VALUES)[number];

/**
 * The answer as the domain wants it, or `null` while it is unanswered.
 *
 * Kept as a function rather than inlined at each call site so that the mapping
 * exists once. Two places converting the string themselves is how one of them
 * ends up treating an unrecognised value as untested, which quietly measures a
 * tested lifter against an untested field.
 */
export function testedFlag(selection: CategorySelection): boolean | null {
  if (selection.tested === 'tested') return true;
  if (selection.tested === 'untested') return false;
  return null;
}

/**
 * A question with few enough answers to show them all at once.
 *
 * Rendered as a group of radio tiles. Three of them survive: sex, equipment and
 * drug-tested status, which between them are at most nine options and are all
 * required, so showing them costs nothing a lifter was not going to pay anyway.
 */
export interface SelectionQuestion {
  readonly field: SelectionField;
  readonly label: string;
  readonly choices: readonly Choice[];
  /** The answer, after anything the catalogue does not offer has been dropped. */
  readonly value: string | null;
  /** Shown instead of the options when there are none. */
  readonly emptyMessage: string;
}

/**
 * A question with too many answers to show them all at once.
 *
 * Rendered as a `ptk-select`. Twelve weight classes, eighteen divisions and
 * fifty states as tiles were most of the screen, and the report underneath them
 * is what a lifter came for. Every one of these is clearable through the
 * placeholder, which is what makes an optional question reversible.
 */
export interface SelectionPicker {
  readonly field: SelectionField;
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly value: string | null;
  /** The option that means "no answer", and the route back to it. */
  readonly placeholder: string;
  /** What answering does, as a description rather than part of the name. */
  readonly hint: string;
  /** Shown instead of the control when there are no options. */
  readonly emptyMessage: string;
}

/**
 * One published records artifact, named for the report.
 *
 * `regionId: null` means the level is not subdivided, which is a settled answer
 * -- there is one national record, not one per state. It never means "the region
 * question has not been answered yet": a level that *is* subdivided simply
 * produces no partition until a region is chosen. Collapsing the two would ask
 * for the artifact of a subdivided level's unsubdivided records, and the read
 * would succeed, return nothing, and be rendered as a federation that publishes
 * no records for the category -- a sentence nobody investigates.
 */
export interface RecordPartition {
  readonly levelId: string;
  readonly regionId: string | null;
  /** How the report names this set of records. */
  readonly label: string;
}

/**
 * One partition's identity, as a string, for keying a map of reads.
 *
 * The report and the transport both need to say "this partition" as a map key,
 * and they have to agree: the transport files a book under a key and the report
 * looks one up by it, so two spellings would render a lifter every partition as
 * empty while all three reads succeeded.
 *
 * Separated by a newline rather than by a hyphen or a colon, because a region
 * identifier is a slug from published data and every other separator is a
 * character a slug may legitimately contain. A newline is the one character
 * `ArtifactPathSchema` and the slug rules both exclude, so `level-a` + `b`
 * cannot collide with `level` + `a-b`. It is a literal `\n` escape and not a
 * literal newline in a template, for the reason CLAUDE.md §2.4 records at
 * length: an invisible character in source once made git treat a file as binary.
 */
export function partitionKey(partition: RecordPartition): string {
  return `${partition.levelId}\n${partition.regionId ?? ''}`;
}

/** Why no Open division could be identified in the published set. */
export type OpenDivisionProblem = 'none' | 'ambiguous';

export interface ResolvedSelection {
  /** The short questions, as tiles. */
  readonly questions: readonly SelectionQuestion[];
  /** The long questions, as selects. Ordered as they are shown. */
  readonly pickers: readonly SelectionPicker[];
  /** The requested selection, minus anything this catalogue cannot offer. */
  readonly selection: CategorySelection;
  /**
   * Enough is answered to draw the report.
   *
   * Deliberately not "every question is answered". The optional questions add
   * columns; none of them can be missing in a way that makes the rest wrong, so
   * blocking on them would hide the report behind answers that do not change it.
   */
  readonly ready: boolean;
  /**
   * The required answers still missing, in the order they are asked.
   *
   * Carried as labels rather than field names because the only thing anybody
   * does with this is write a sentence out of it, and a component turning
   * `weightClass` into "Weight class" would be a second copy of every label.
   */
  readonly outstanding: readonly string[];
  /**
   * The classes the report has a column for: one, or two to compare.
   *
   * In ladder order rather than in the order they were picked, and deduplicated
   * -- a lifter who chooses the same class twice gets one column rather than two
   * identical ones side by side.
   */
  readonly weightClasses: readonly WeightClass[];
  /**
   * The divisions the report covers: Open, plus whichever one was chosen.
   *
   * Open is always first and is never removable, which is requirement 2 in one
   * line: a lifter looking at Masters 45-49 still needs to see what the same
   * lifts are worth in Open, because that is the division most of them enter.
   */
  readonly divisions: readonly AgeDivision[];
  /** Why Open is missing from the list above, or `null` when it is not. */
  readonly openDivisionProblem: OpenDivisionProblem | null;
  /** Every record artifact the report should read, in the order it shows them. */
  readonly partitions: readonly RecordPartition[];
  /**
   * Every event the federation contests.
   *
   * All of them, unfiltered: the report shows a lifter what they might hit at
   * any meet, and a bench-only record is exactly as reachable as a full-power
   * one. Asking which event a lifter had in mind narrowed the report to a third
   * of what the data can say, for an answer they had no reason to have decided.
   */
  readonly disciplines: readonly Discipline[];
}

/**
 * How the sex categories are written on screen.
 *
 * A closed picklist in the contracts package, so these are interface strings
 * rather than federation data, and hard-coding them here does not put a number
 * in source. Which of them a lifter is *offered* still comes from the catalogue:
 * a federation that publishes one ladder asks a question with one answer, not a
 * question with an answer that leads nowhere.
 */
const SEX_LABELS: Readonly<Record<SexCategory, string>> = {
  female: 'Female',
  male: 'Male',
};

/**
 * Descriptions rather than bare labels, because "Untested" is widely misread as
 * "has not been tested yet" rather than as the division's name.
 */
const TESTED_CHOICES: readonly Choice[] = [
  { value: 'tested', label: 'Tested', description: 'Competing in drug-tested divisions' },
  { value: 'untested', label: 'Untested', description: 'Competing in untested divisions' },
];

export function resolveSelection(
  catalog: CategoryCatalog,
  requested: CategorySelection,
): ResolvedSelection {
  const resolved: Record<SelectionField, string | null> = { ...NO_SELECTION };
  const questions: SelectionQuestion[] = [];
  const pickers: SelectionPicker[] = [];

  /**
   * Adds a tile question, keeping the requested answer only if it is on offer.
   *
   * Asking in order is what makes one pass enough: a question that depends on an
   * earlier answer reads it from `resolved`, which has already been cleaned.
   */
  function ask(
    field: SelectionField,
    label: string,
    choices: readonly Choice[],
    emptyMessage: string,
  ): void {
    const value = offered(
      choices.map((choice) => choice.value),
      requested[field],
    );
    resolved[field] = value;
    questions.push({ field, label, choices, value, emptyMessage });
  }

  /** The same, for a question long enough to need a select. */
  function pick(picker: Omit<SelectionPicker, 'value'>): void {
    const value = offered(
      picker.options.map((option) => option.value),
      requested[picker.field],
    );
    resolved[picker.field] = value;
    pickers.push({ ...picker, value });
  }

  ask('sex', 'Sex category', sexChoices(catalog), 'No sex categories are published.');
  ask(
    'equipment',
    'Equipment',
    catalog.equipment.map((equipment) => ({ value: equipment.id, label: equipment.label })),
    'No equipment categories are published.',
  );

  // Asked before the classes, and third rather than last, because it is the
  // cheapest of the four required answers and the two long pickers below read
  // better once the tiles above them are settled. It is not redundant for a
  // federation that publishes one set of standards for everybody: records and
  // qualifying totals are split on it where classifications are not, and a
  // screen that only asked when the current federation happened to need it would
  // drop the question the day a second one did -- silently, since an unasked
  // question reads as an answered one downstream.
  ask('tested', 'Drug-tested status', TESTED_CHOICES, 'No drug-tested categories are published.');

  const ladder = weightClassOptions(catalog, resolved.sex);
  pick({
    field: 'weightClass',
    label: 'Weight class',
    options: ladder.options,
    placeholder: 'Not selected',
    hint: '',
    emptyMessage: ladder.emptyMessage,
  });
  pick({
    field: 'comparisonWeightClass',
    // Named for the thing it produces rather than for the act of comparing. The
    // report shows two columns in every matrix, and "Comparison class" is what
    // the second column is called there -- a control named "Compare with" leaves
    // a reader matching a verb against a heading.
    label: 'Comparison class',
    options: ladder.options,
    placeholder: 'One class only',
    hint: 'Optional. Adds a second class to the report, side by side.',
    emptyMessage: ladder.emptyMessage,
  });

  const open = openAgeDivision(catalog.ageDivisions.divisions);
  pick({
    field: 'division',
    // "Age division", which is what the federation calls these and what the row
    // headings in the report say. An earlier version read "Masters or Juniors
    // division", on the argument that a lifter of thirty would otherwise think
    // the question was aimed at them; usability review found the opposite
    // problem to be the real one -- a label naming two families does not match
    // any published division name, so a lifter looking for "Master 50-54" has to
    // work out that this is the control that offers it. The placeholder does the
    // job the old label was trying to do, and does it without renaming the data.
    label: 'Age division',
    options: divisionOptions(catalog.ageDivisions.divisions, open.ok ? open.division : null),
    placeholder: 'Open only',
    hint: 'Optional. Open stays visible because many lifters cross-enter.',
    emptyMessage: 'No age divisions are published.',
  });

  const subdivided = subdividedLevel(catalog);
  if (subdivided.level !== null || subdivided.problem !== null) {
    pick({
      field: 'region',
      label: subdivided.level?.label ?? 'Region',
      options:
        subdivided.level?.regions.map((region) => ({
          value: region.id,
          label: region.label,
        })) ?? [],
      placeholder: 'Not selected',
      hint: `Optional. Adds ${
        subdivided.level === null ? 'regional' : subdivided.level.label.toLowerCase()
      } records to the report. World and national records are always shown.`,
      emptyMessage:
        subdivided.problem === 'ambiguous'
          ? 'More than one kind of regional record is published, so none can be offered.'
          : 'No regions are published.',
    });
  }

  // Both kinds of control at once, in ask order, so the sentence that names what
  // is left cannot silently omit the weight class for being a picker rather than
  // a question. That omission is the readable-but-wrong version: the screen says
  // everything is answered while the report stays blank.
  const outstanding = [...questions, ...pickers]
    .filter((control) => REQUIRED_FIELDS.includes(control.field) && control.value === null)
    .map((control) => control.label);

  return {
    questions,
    pickers,
    selection: resolved,
    ready: outstanding.length === 0,
    outstanding,
    weightClasses: chosenWeightClasses(ladder.classes, [
      resolved.weightClass,
      resolved.comparisonWeightClass,
    ]),
    divisions: chosenDivisions(
      catalog.ageDivisions.divisions,
      open.ok ? open.division : null,
      resolved.division,
    ),
    openDivisionProblem: open.ok ? null : open.reason,
    partitions: partitionsFor(catalog, subdivided.level, resolved.region),
    disciplines: catalog.disciplines,
  };
}

/** The requested answer if the catalogue offers it, `null` otherwise. */
function offered(values: readonly string[], requested: string | null): string | null {
  return values.some((value) => value === requested) ? requested : null;
}

/**
 * The sex categories this federation actually publishes classes for.
 *
 * Derived from the ladders rather than from the picklist, because offering a
 * category the catalogue has no classes for produces a question whose answer
 * empties the next one.
 */
function sexChoices(catalog: CategoryCatalog): readonly Choice[] {
  const seen = new Set<SexCategory>();
  const choices: Choice[] = [];
  for (const ladder of catalog.weightClassLadders) {
    if (seen.has(ladder.sex)) {
      continue;
    }
    seen.add(ladder.sex);
    choices.push({ value: ladder.sex, label: SEX_LABELS[ladder.sex] });
  }
  return choices;
}

/**
 * The classes for the chosen sex category, plus the classes themselves.
 *
 * Both, because the pickers need options and the report needs the published
 * `WeightClass` objects behind them -- and deriving the second from the first
 * elsewhere would mean a second lookup that can disagree about which ladder is
 * in play.
 *
 * Two published ladders for one sex is refused rather than resolved by document
 * order. Picking the first would show a plausible list of classes that half the
 * time is the wrong one, and no part of the screen would indicate it; saying
 * nothing can be shown at least sends someone to look at the published data.
 */
function weightClassOptions(
  catalog: CategoryCatalog,
  sex: string | null,
): { options: readonly SelectOption[]; classes: readonly WeightClass[]; emptyMessage: string } {
  const nothing = { options: [], classes: [] } as const;
  if (sex === null) {
    return { ...nothing, emptyMessage: 'Choose a sex category to see its weight classes.' };
  }

  const ladders = catalog.weightClassLadders.filter((ladder) => ladder.sex === sex);
  const [ladder, ...rest] = ladders;
  if (ladder === undefined) {
    return { ...nothing, emptyMessage: 'No weight classes are published for this category.' };
  }
  if (rest.length > 0) {
    return {
      ...nothing,
      emptyMessage:
        'More than one set of weight classes is published for this category, so none can be shown.',
    };
  }

  return {
    options: ladder.classes.map((weightClass) => ({
      value: weightClass.id,
      label: weightClass.label,
    })),
    classes: ladder.classes,
    emptyMessage: 'No weight classes are published for this category.',
  };
}

/**
 * The chosen classes, in ladder order and without a duplicate.
 *
 * Ladder order rather than the order they were picked, so that the lighter class
 * is always the left-hand column however a lifter arrived at the pair -- a
 * comparison whose columns swap depending on which control was touched last is
 * one a reader has to re-check every time.
 */
function chosenWeightClasses(
  classes: readonly WeightClass[],
  chosen: readonly (string | null)[],
): readonly WeightClass[] {
  const wanted = new Set(chosen.filter((id): id is string => id !== null));
  return classes.filter((weightClass) => wanted.has(weightClass.id));
}

/**
 * The divisions the report covers, Open first.
 *
 * `null` for the Open division is a real case -- a published set with two
 * equally wide divisions is ambiguous and this refuses to guess -- and it leaves
 * the report showing whichever division was chosen and nothing else, with
 * {@link ResolvedSelection.openDivisionProblem} saying why.
 */
function chosenDivisions(
  divisions: readonly AgeDivision[],
  open: AgeDivision | null,
  chosenId: string | null,
): readonly AgeDivision[] {
  const chosen = divisions.find((division) => division.id === chosenId) ?? null;
  if (open === null) {
    return chosen === null ? [] : [chosen];
  }
  // An identity check, not an id one: `open` came out of this same array.
  return chosen === null || chosen === open ? [open] : [open, chosen];
}

/**
 * The division options, with Open removed and the rest filed under a heading.
 *
 * Open is not offered because it is not optional -- it is in every report
 * whatever this control says, so listing it would present the always-on column
 * as something to choose, and choosing it would appear to do nothing.
 *
 * The headings come from the first word of each published label, which is how
 * these sets are actually named ("Junior 20-23", "Master 40-44"). Two guards
 * keep that from producing nonsense for a federation that names them some other
 * way: it needs at least two distinct leading words, and strictly fewer distinct
 * words than divisions -- otherwise every option gets its own heading, which is
 * an eighteen-item list with eighteen headings in it.
 */
function divisionOptions(
  divisions: readonly AgeDivision[],
  open: AgeDivision | null,
): readonly SelectOption[] {
  const offerable = divisions
    .filter((division) => division !== open)
    // Ascending by the age it starts at, so the list reads youngest to oldest
    // whatever order the source published it in. A division with no floor sorts
    // first, which is where "and under" belongs.
    .toSorted(
      (a, b) =>
        (a.minimumAge ?? Number.NEGATIVE_INFINITY) - (b.minimumAge ?? Number.NEGATIVE_INFINITY),
    );

  const families = new Set(offerable.map((division) => leadingWord(division.label)));
  const grouped = families.size >= 2 && families.size < offerable.length;

  return offerable.map((division) => {
    const band = ageRange(division.minimumAge, division.maximumAge);
    // The band goes in the label rather than beside it: a native option has one
    // line and no room for a description, and a lifter picking between "Junior
    // 15-19" and "Junior 16-17" is picking on the numbers.
    const label = band === null ? division.label : `${division.label} (${band})`;
    return grouped
      ? { value: division.id, label, group: leadingWord(division.label) }
      : { value: division.id, label };
  });
}

/** The first word of a label, which is how a division family is named. */
function leadingWord(label: string): string {
  return label.split(' ')[0] ?? label;
}

/**
 * The age band, or `null` for a division that admits everyone.
 *
 * Divisions overlap by design and their names do not say so -- "Masters 1" and
 * "Submaster" mean different bands in different federations. Showing the band
 * the catalogue published is what lets a lifter notice they are eligible for two
 * of them, which is the situation the tool exists to surface rather than hide.
 */
function ageRange(minimumAge: number | null, maximumAge: number | null): string | null {
  if (minimumAge === null && maximumAge === null) {
    return null;
  }
  if (minimumAge === null) {
    return `${String(maximumAge)} and under`;
  }
  if (maximumAge === null) {
    return `${String(minimumAge)} and over`;
  }
  return `${String(minimumAge)} to ${String(maximumAge)}`;
}

/**
 * The one level that is divided into regions, if there is exactly one.
 *
 * There is no level *question* any more: a report shows every level a lifter
 * could set a record at, and asking them to pick one hid two thirds of it behind
 * a radio. What a region still needs is a level to belong to, and rather than
 * hard-coding which one that is -- there is no federation identifier anywhere in
 * this file, by §5.1 -- it is derived: an unsubdivided level needs no region and
 * is always read, a subdivided one needs a region and is read only once there is
 * one.
 *
 * Two subdivided levels is refused rather than resolved by document order.
 * `SelectionField` is a closed union with one `region` in it, so a second one
 * would have nowhere to be recorded, and quietly attaching the question to the
 * first level would show a lifter a list of states under a heading naming
 * something else.
 */
function subdividedLevel(catalog: CategoryCatalog): {
  level: CompetitionLevel | null;
  problem: 'ambiguous' | null;
} {
  const [level, ...rest] = catalog.levels.filter((candidate) => candidate.regions.length > 0);
  if (level === undefined) {
    return { level: null, problem: null };
  }
  if (rest.length > 0) {
    return { level: null, problem: 'ambiguous' };
  }
  return { level, problem: null };
}

/**
 * Every artifact the report reads, in the order the report shows them.
 *
 * Catalogue order, which for a federation that publishes state, national and
 * world tables runs closest-to-home first. That is the order a lifter plans in:
 * the state record is the one they might take this year.
 */
function partitionsFor(
  catalog: CategoryCatalog,
  subdivided: CompetitionLevel | null,
  regionId: string | null,
): readonly RecordPartition[] {
  const partitions: RecordPartition[] = [];
  for (const level of catalog.levels) {
    if (level !== subdivided) {
      // Not subdivided, so there is one set of records and nothing to ask.
      // (A second subdivided level is excluded here too: `subdividedLevel`
      // returned none, so neither of them is offered a region and neither can
      // be read without one.)
      if (level.regions.length === 0) {
        partitions.push({ levelId: level.id, regionId: null, label: level.label });
      }
      continue;
    }
    const region = level.regions.find((candidate) => candidate.id === regionId);
    if (region !== undefined) {
      partitions.push({
        levelId: level.id,
        regionId: region.id,
        label: `${region.label} ${level.label}`,
      });
    }
  }
  return partitions;
}
