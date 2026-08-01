/**
 * Reads what the lifter typed against the standards their category publishes.
 *
 * Pure: no DOM, no data source, no Lit. Everything below is a function of the
 * published book, the answered category, and four strings. That is what lets the
 * awkward cases -- a federation that publishes no standards for a division, a
 * table whose ranks disagree with its totals, a lifter who typed `1o5` -- be
 * tested as data rather than driven through a rendered page.
 *
 * TWO AXES, NOT ONE UNION
 *
 * What the visitor typed and which table applies are independent, and modelling
 * them as one outcome loses a real state: a lifter who mistypes their squat in a
 * category with no published squat standards should be told both things, and a
 * single union has to pick one. So {@link LiftStanding} carries an
 * {@link LiftEntry} and a {@link LiftStandards} side by side, and the placement
 * exists only when both are available.
 *
 * WHY THE MESSAGES ARE HERE
 *
 * `parseKilograms` in `packages/domain` reports failures for whoever maintains a
 * data feed -- its reasons quote the offending input, which is right for a CI log
 * and wrong for a person who just mistyped. The user-facing sentences are layered
 * over it here, and they are in this module rather than in the component so they
 * can be asserted without a browser.
 */
import type {
  ClassificationBook,
  ClassificationTable,
  Lift,
  SexCategory,
} from '@platform-toolkit/data-contracts';
import {
  ClassificationLadder,
  parseKilograms,
  selectClassificationTable,
  type Classification,
  type ClassificationLadderProblem,
} from '@platform-toolkit/domain';

import { testedFlag, type CategorySelection } from './selection.js';

/**
 * The lifts a screen shows, in platform order.
 *
 * The three competition lifts in the order they are contested, then the total.
 * Not derived from the published tables: a category with no published deadlift
 * standard still has a deadlift, and dropping the field would leave a lifter
 * unable to enter a number the total is then supposed to account for.
 */
export const LIFTS: readonly Lift[] = ['squat', 'bench', 'deadlift', 'total'];

/** The three that add up. */
const COMPONENT_LIFTS: readonly Lift[] = ['squat', 'bench', 'deadlift'];

export const LIFT_LABELS: Readonly<Record<Lift, string>> = {
  squat: 'Squat',
  bench: 'Bench press',
  deadlift: 'Deadlift',
  total: 'Total',
};

/** What is in each field, exactly as typed. */
export type LiftEntries = Readonly<Record<Lift, string>>;

export const NO_ENTRIES: LiftEntries = { squat: '', bench: '', deadlift: '', total: '' };

/** What the field contains, once read as a weight. */
export type LiftEntry =
  | { readonly kind: 'empty' }
  /** Something was typed and it is not a usable weight. `message` is for the lifter. */
  | { readonly kind: 'invalid'; readonly message: string }
  | {
      readonly kind: 'weight';
      readonly kilograms: number;
      /** True when it was added up from the three lifts rather than typed. */
      readonly derived: boolean;
    };

/** Which table of standards applies to this lifter and this lift, if any. */
export type LiftStandards =
  /** The category is not fully answered yet, so no table can be chosen. */
  | { readonly kind: 'unselected' }
  /** The federation publishes nothing for this lift in this category. */
  | { readonly kind: 'none' }
  /** Two equally specific tables match. Reported, never resolved by order. */
  | { readonly kind: 'ambiguous' }
  /** A table matched and could not be trusted. The problems are for maintainers. */
  | { readonly kind: 'unreadable'; readonly problems: readonly ClassificationLadderProblem[] }
  | {
      readonly kind: 'ladder';
      readonly table: ClassificationTable;
      readonly ladder: ClassificationLadder;
    };

export interface LiftStanding {
  readonly lift: Lift;
  readonly label: string;
  readonly entry: LiftEntry;
  readonly standards: LiftStandards;
  /** Where the entry sits in the ladder. `null` unless there is both an entry and a ladder. */
  readonly classification: Classification | null;
}

/** A lifter, as far as choosing tables of standards is concerned. */
export interface LifterCategory {
  readonly sex: SexCategory;
  readonly equipmentId: string;
  readonly weightClassId: string;
  readonly divisionId: string;
  readonly tested: boolean;
}

/**
 * The sex categories the contract admits, as a value rather than a type.
 *
 * A selection holds a `string`, because that is what a radio reports, and the
 * narrowing has to happen somewhere. Doing it with a cast would compile happily
 * against a value the catalogue never offered and select a table for it, so it
 * is done by checking.
 */
const SEX_CATEGORIES: readonly SexCategory[] = ['female', 'male'];

/**
 * The lifter's category, or `null` while any part of it is unanswered.
 *
 * Deliberately all-or-nothing. Every axis narrows which table applies, and a
 * partial category would select the general table and present it as the
 * lifter's -- which is the failure mode this whole screen exists to prevent, in
 * the one place where nothing on screen would look unfinished.
 */
export function lifterCategoryFrom(selection: CategorySelection): LifterCategory | null {
  const sex = SEX_CATEGORIES.find((candidate) => candidate === selection.sex);
  const tested = testedFlag(selection);
  const { equipment, weightClass, division } = selection;
  if (
    sex === undefined ||
    tested === null ||
    equipment === null ||
    weightClass === null ||
    division === null
  ) {
    return null;
  }
  return { sex, equipmentId: equipment, weightClassId: weightClass, divisionId: division, tested };
}

/**
 * Reads every lift at once.
 *
 * One call for the whole screen rather than one per lift, because the total can
 * be derived from the other three and deriving it needs them all.
 */
export function resolveStandards(
  book: ClassificationBook | null,
  category: LifterCategory | null,
  entries: LiftEntries,
): readonly LiftStanding[] {
  const typed = new Map<Lift, LiftEntry>(LIFTS.map((lift) => [lift, readEntry(entries[lift])]));
  const derivedTotal = deriveTotal(typed);

  return LIFTS.map((lift) => {
    const entry = lift === 'total' && derivedTotal !== null ? derivedTotal : entryOf(typed, lift);
    const standards = standardsFor(book, category, lift);
    return {
      lift,
      label: LIFT_LABELS[lift],
      entry,
      standards,
      classification:
        entry.kind === 'weight' && standards.kind === 'ladder'
          ? standards.ladder.classify(entry.kilograms)
          : null,
    };
  });
}

/** `Map.get` is `| undefined`, and every lift was just put in. */
function entryOf(typed: ReadonlyMap<Lift, LiftEntry>, lift: Lift): LiftEntry {
  return typed.get(lift) ?? { kind: 'empty' };
}

/**
 * The total, added up, when it was not typed and all three lifts were.
 *
 * Adding up three numbers on a phone between attempts is exactly the arithmetic
 * this tool exists to remove. It only ever fills an *empty* field -- a typed
 * total wins, because a lifter entering one directly is telling us something the
 * three fields cannot: their best total came from a different day.
 */
function deriveTotal(typed: ReadonlyMap<Lift, LiftEntry>): LiftEntry | null {
  if (entryOf(typed, 'total').kind !== 'empty') {
    return null;
  }
  let sum = 0;
  for (const lift of COMPONENT_LIFTS) {
    const entry = entryOf(typed, lift);
    if (entry.kind !== 'weight') {
      return null;
    }
    sum += entry.kilograms;
  }
  // Rounded because binary floating point turns 62.5 + 42.5 + 145 into a figure
  // with a tail, and a total displayed as 250.00000000000003 is a bug report.
  return { kind: 'weight', kilograms: roundToHundredths(sum), derived: true };
}

/**
 * Reads one field.
 *
 * Empty is not an error: an unanswered question is a normal state of this
 * screen, and colouring it red the moment the page loads is the single easiest
 * way to make a tool feel broken.
 */
function readEntry(raw: string): LiftEntry {
  if (raw.trim() === '') {
    return { kind: 'empty' };
  }
  const parsed = parseKilograms(raw);
  if (!parsed.ok) {
    // The domain reason is not reused. It quotes the input back, which is right
    // for a CI log reading a data feed and wrong on a screen where the input is
    // already visible one line above.
    return { kind: 'invalid', message: 'Enter a weight in kilograms, for example 142.5.' };
  }
  if (parsed.kilograms <= 0) {
    // Its own message, and a real case: `0` parses. Classifying it would throw,
    // and the standards are floors above zero, so there is nothing to say about
    // it beyond this.
    return { kind: 'invalid', message: 'Enter a weight above zero.' };
  }
  return { kind: 'weight', kilograms: parsed.kilograms, derived: false };
}

function standardsFor(
  book: ClassificationBook | null,
  category: LifterCategory | null,
  lift: Lift,
): LiftStandards {
  if (category === null) {
    return { kind: 'unselected' };
  }
  if (book === null) {
    return { kind: 'none' };
  }

  const selected = selectClassificationTable({ ...category, lift }, book.tables);
  if (!selected.ok) {
    return selected.reason === 'ambiguous' ? { kind: 'ambiguous' } : { kind: 'none' };
  }

  // The table came through a validated artifact, so its shape is sound; what
  // `from` checks is the thing a schema cannot -- that the declared ranks and
  // the required weights tell the same story. A table that fails here is
  // reported rather than sorted into a plausible order, because a plausible
  // order from a mistranscribed table tells a lifter they earned a title.
  const built = ClassificationLadder.from(selected.table.standards);
  if (!built.ok) {
    return { kind: 'unreadable', problems: built.problems };
  }
  return { kind: 'ladder', table: selected.table, ladder: built.ladder };
}

/**
 * The status line under one field.
 *
 * A sentence rather than a set of flags, because it is read aloud as one and
 * because writing it here is what makes every combination assertable. The
 * ordering matters: what is wrong with the entry comes before what is wrong with
 * the data, since the lifter can fix the first and can only report the second.
 */
export function standingSummary(standing: LiftStanding): string {
  if (standing.entry.kind === 'invalid') {
    return standing.entry.message;
  }

  switch (standing.standards.kind) {
    case 'unselected':
      return 'Answer every question above to see the standards for your category.';
    case 'none':
      return 'This federation publishes no standards for this lift in your category.';
    case 'ambiguous':
      return 'More than one set of standards applies to this category, so none can be shown.';
    case 'unreadable':
      return 'The published standards for this category could not be read.';
    case 'ladder':
      break;
  }

  const { ladder } = standing.standards;
  if (standing.entry.kind === 'empty') {
    const first = ladder.standards.at(0);
    const last = ladder.standards.at(-1);
    // `at` is `| undefined` and a ladder is never empty -- `ClassificationLadder`
    // rejects that -- but proving it to the checker with a cast would be a cast
    // in exchange for nothing.
    if (first === undefined || last === undefined) {
      return 'No standards are published for this lift in your category.';
    }
    return `${first.label} at ${formatKilograms(first.requiredKilograms)} kg, up to ${last.label} at ${formatKilograms(last.requiredKilograms)} kg.`;
  }

  return placementSummary(standing.classification, standing.entry.derived);
}

function placementSummary(classification: Classification | null, derived: boolean): string {
  if (classification === null) {
    // Only reachable if a caller built a standing by hand with an entry and a
    // ladder and no placement. Saying so plainly beats an empty line.
    return 'This weight has not been read against the standards.';
  }

  const prefix = derived ? 'From your three lifts. ' : '';
  const reached =
    classification.achieved === null
      ? 'Below the first published standard.'
      : `${classification.achieved.label}.`;

  if (classification.next === null || classification.kilogramsToNext === null) {
    return `${prefix}${reached} This is the highest published standard.`;
  }
  return `${prefix}${reached} ${formatKilograms(classification.kilogramsToNext)} kg to ${classification.next.label}.`;
}

/**
 * A weight as a person writes it: `142.5`, not `142.50`, and `100`, not `100.0`.
 *
 * Trailing zeros read as false precision on a screen full of half-kilogram
 * increments, and `toFixed` alone produces them on every whole number.
 */
export function formatKilograms(kilograms: number): string {
  return String(roundToHundredths(kilograms));
}

function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}
