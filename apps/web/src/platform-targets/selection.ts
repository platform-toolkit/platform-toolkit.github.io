/**
 * Turns a published catalogue into the questions the manual path asks, and
 * keeps the answers honest as they change.
 *
 * This is the half of the selection interface that knows what an option *means*
 * -- that a weight class belongs to one sex's ladder, that a division has an age
 * band -- which is why it lives in the tool rather than in `packages/ui`. It is
 * pure: no DOM, no data source, no Lit. The component below it decides how the
 * questions look; this decides what they are.
 *
 * The rule worth stating outright is that an answer the catalogue does not offer
 * is not an answer. `resolveSelection` drops it rather than keeping it. Without
 * that, a lifter who picks the 56 kg class and then corrects their sex category
 * keeps a class from the other ladder, and every number downstream -- records,
 * classification standards, qualifying totals -- is drawn from a category they
 * are not in. Nothing about the screen would look wrong.
 */
import type { CategoryCatalog, SexCategory } from '@platform-toolkit/data-contracts';
import type { Choice } from '@platform-toolkit/ui';

/** The questions, in the order they are asked. */
export type SelectionField = 'sex' | 'equipment' | 'weightClass' | 'division' | 'tested';

/** What the lifter has chosen so far. `null` is "not answered yet". */
export type CategorySelection = Readonly<Record<SelectionField, string | null>>;

export const NO_SELECTION: CategorySelection = {
  sex: null,
  equipment: null,
  weightClass: null,
  division: null,
  tested: null,
};

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

/** One question, ready to hand to a choice group. */
export interface SelectionQuestion {
  readonly field: SelectionField;
  readonly label: string;
  readonly choices: readonly Choice[];
  /** The answer, after anything the catalogue does not offer has been dropped. */
  readonly value: string | null;
  /** Shown instead of the options when there are none. */
  readonly emptyMessage: string;
}

export interface ResolvedSelection {
  readonly questions: readonly SelectionQuestion[];
  /** The requested selection, minus anything this catalogue cannot offer. */
  readonly selection: CategorySelection;
  /** Every question answered, so a category is fully identified. */
  readonly complete: boolean;
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

  /**
   * Adds a question, keeping the requested answer only if it is on offer.
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
    const requestedValue = requested[field];
    const value = choices.some((choice) => choice.value === requestedValue) ? requestedValue : null;
    resolved[field] = value;
    questions.push({ field, label, choices, value, emptyMessage });
  }

  ask('sex', 'Sex category', sexChoices(catalog), 'No sex categories are published.');
  ask(
    'equipment',
    'Equipment',
    catalog.equipment.map((equipment) => ({ value: equipment.id, label: equipment.label })),
    'No equipment categories are published.',
  );

  const classes = weightClassQuestion(catalog, resolved.sex);
  ask('weightClass', 'Weight class', classes.choices, classes.emptyMessage);

  ask('division', 'Age division', divisionChoices(catalog), 'No age divisions are published.');

  // Last, and asked even by federations that publish one set of standards for
  // everybody. It is not redundant there: records and qualifying totals are
  // split on it where classifications are not, and a screen that only asked when
  // the current federation happened to need it would drop the question the day a
  // second one did -- silently, since an unasked question reads as an answered
  // one downstream.
  ask('tested', 'Drug-tested status', TESTED_CHOICES, 'No drug-tested categories are published.');

  return {
    questions,
    selection: resolved,
    // A question with no answers can never be satisfied, so an unanswerable
    // catalogue is incomplete rather than complete-by-vacuum.
    complete: questions.every((question) => question.value !== null),
  };
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
 * The classes for the chosen sex category.
 *
 * Two published ladders for one sex is refused rather than resolved by document
 * order. Picking the first would show a plausible list of classes that half the
 * time is the wrong one, and no part of the screen would indicate it; saying
 * nothing can be shown at least sends someone to look at the published data.
 */
function weightClassQuestion(
  catalog: CategoryCatalog,
  sex: string | null,
): { choices: readonly Choice[]; emptyMessage: string } {
  if (sex === null) {
    return { choices: [], emptyMessage: 'Choose a sex category to see its weight classes.' };
  }

  const ladders = catalog.weightClassLadders.filter((ladder) => ladder.sex === sex);
  const [ladder, ...rest] = ladders;
  if (ladder === undefined) {
    return { choices: [], emptyMessage: 'No weight classes are published for this category.' };
  }
  if (rest.length > 0) {
    return {
      choices: [],
      emptyMessage:
        'More than one set of weight classes is published for this category, so none can be shown.',
    };
  }

  return {
    choices: ladder.classes.map((weightClass) => ({
      value: weightClass.id,
      label: weightClass.label,
    })),
    emptyMessage: 'No weight classes are published for this category.',
  };
}

function divisionChoices(catalog: CategoryCatalog): readonly Choice[] {
  return catalog.ageDivisions.divisions.map((division) => {
    const description = ageRange(division.minimumAge, division.maximumAge);
    return {
      value: division.id,
      label: division.label,
      // Built conditionally rather than passed as `undefined`:
      // `exactOptionalPropertyTypes` makes the difference real, and an absent
      // description is what the choice group renders as one line.
      ...(description === null ? {} : { description }),
    };
  });
}

/**
 * The age band as a second line, or `null` for a division that admits everyone.
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
