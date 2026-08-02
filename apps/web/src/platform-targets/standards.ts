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
 * single union has to pick one. So {@link LiftEntry} and {@link LiftStandards}
 * are separate types, resolved by separate calls, and no caller has to have
 * answered the category before it can read what was typed.
 *
 * WHY THE MESSAGES ARE HERE
 *
 * `parseWeightInput` in `packages/domain` reports failures as codes, which is
 * what a caller needs and not what a person needs. The user-facing sentences are
 * layered over it here, and they are in this module rather than in the component
 * so they can be asserted without a browser.
 *
 * TWO UNITS, ONE SET OF STANDARDS
 *
 * The standards are published in kilograms and are only ever compared in
 * kilograms. What the lifter types may be in either unit, and the difference is
 * kept in {@link LiftField} rather than resolved on the way in, so that switching
 * units is a change of view and never a change of value.
 */
import type {
  ClassificationBook,
  ClassificationTable,
  Lift,
  SexCategory,
} from '@platform-toolkit/data-contracts';
import {
  ClassificationLadder,
  enterWeight,
  entryAmount,
  parseWeightInput,
  roundToPlaces,
  selectClassificationTable,
  showEntryIn,
  weightIn,
  type ClassificationLadderProblem,
  type EnteredWeight,
  type ParsedWeightInput,
  type WeightUnit,
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

/**
 * One field: exactly what was typed, and the figure behind it.
 *
 * `weight` is the drift-free origin -- the number in the unit it was typed in --
 * and it is `null` whenever the text is empty or does not read as a weight. It
 * exists so that switching units repeatedly returns the lifter to the number they
 * typed rather than to that number plus a rounding per toggle: 130 kg shown in
 * pounds is 286.6, and 286.6 pounds read back as kilograms is 129.99, which after
 * a few flicks is a different squat.
 */
export interface LiftField {
  readonly text: string;
  readonly weight: EnteredWeight | null;
}

const EMPTY_FIELD: LiftField = { text: '', weight: null };

/** What is in the four fields, and the unit they are being entered in. */
export interface LiftEntries {
  readonly unit: WeightUnit;
  readonly fields: Readonly<Record<Lift, LiftField>>;
}

export const NO_ENTRIES: LiftEntries = {
  unit: 'kg',
  fields: { squat: EMPTY_FIELD, bench: EMPTY_FIELD, deadlift: EMPTY_FIELD, total: EMPTY_FIELD },
};

/** Accepts a keystroke. What it means is decided on the way out, not here. */
export function typeLift(entries: LiftEntries, lift: Lift, text: string): LiftEntries {
  const parsed = parseWeightInput(text);
  return {
    ...entries,
    fields: { ...entries.fields, [lift]: { text, weight: originOf(parsed, entries.unit) } },
  };
}

/**
 * The figure behind a field, in the unit it was actually written in.
 *
 * A typed suffix wins over the panel's unit. Somebody who pastes `183.7 kg` into
 * a field currently showing pounds has said which unit they mean, and reading it
 * as 183.7 lb because of where the radio happens to sit discards the one piece of
 * information that resolves the ambiguity.
 */
function originOf(parsed: ParsedWeightInput, fieldUnit: WeightUnit): EnteredWeight | null {
  if (!parsed.ok || parsed.amount <= 0) {
    return null;
  }
  return enterWeight(parsed.amount, parsed.unit ?? fieldUnit);
}

/**
 * Switches the unit, converting every figure rather than rereading it.
 *
 * The same rule tool 3 states outright, and it matters more here than there. A
 * lift entered on this screen is a fact about a meet that already happened, so
 * "405" does not become 405 kg because the lifter tapped a different radio -- it
 * stays the 405 lb they lifted. Reinterpreting instead would turn a 405 lb squat
 * into a 405 kg squat, which is not a plausible mistake to notice on screen: it
 * is simply reported back as Elite.
 */
export function setEntryUnit(entries: LiftEntries, unit: WeightUnit): LiftEntries {
  if (unit === entries.unit) {
    return entries;
  }
  const fields = { ...entries.fields };
  for (const lift of LIFTS) {
    const field = entries.fields[lift];
    // Text that never read as a weight has nothing to convert, and rewriting it
    // would delete what the lifter typed in the middle of correcting it.
    if (field.weight === null) {
      continue;
    }
    const shown = showEntryIn(field.weight, unit);
    fields[lift] = { text: String(entryAmount(shown)), weight: shown };
  }
  return { unit, fields };
}

/** What the field contains, once read as a weight. */
export type LiftEntry =
  | { readonly kind: 'empty' }
  /** Something was typed and it is not a usable weight. `message` is for the lifter. */
  | { readonly kind: 'invalid'; readonly message: string }
  | {
      readonly kind: 'weight';
      /** Always kilograms: the published standards are in kilograms and nothing else compares. */
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

/**
 * Which table applies to one lift, and what it says.
 *
 * Deliberately carries nothing the lifter typed. The report draws every rung of
 * the ladder and strikes through the ones already behind them, which is a
 * question about a *weight* and not about a category -- so it is answered by
 * `reachedIn` in `report.ts`, in a second pass, against whichever weight is in
 * hand. Folding an entry in here would mean re-resolving the whole book on every
 * keystroke to redraw rows that had not changed.
 */
export interface LiftStanding {
  readonly lift: Lift;
  readonly label: string;
  readonly standards: LiftStandards;
}

/**
 * The three axes every column of the report shares.
 *
 * Split out from {@link LifterCategory} because the report shows one lifter in
 * up to two weight classes and up to two divisions at once: those two axes vary
 * *within* one screen, and these three do not. Keeping them apart is what lets
 * the transport key a read on the axes that choose an artifact (§5.4) while the
 * report walks the ones that only choose a row.
 */
export interface LifterAxes {
  readonly sex: SexCategory;
  readonly equipmentId: string;
  readonly tested: boolean;
}

/** A lifter, as far as choosing tables of standards is concerned. */
export interface LifterCategory extends LifterAxes {
  readonly weightClassId: string;
  readonly divisionId: string;
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
 * The three shared axes, or `null` while any of them is unanswered.
 *
 * Deliberately all-or-nothing. Every axis narrows which table applies, and a
 * partial category would select the general table and present it as the
 * lifter's -- which is the failure mode this whole screen exists to prevent, in
 * the one place where nothing on screen would look unfinished.
 *
 * It reads the weight class and the division from nowhere, on purpose. Both used
 * to come off the same selection and the function returned a whole
 * {@link LifterCategory}; the report now shows up to two of each at once, and a
 * function that quietly picked the *first* of them would have produced one
 * correct column and silently dropped the comparison the lifter asked for.
 */
export function lifterAxesFrom(selection: CategorySelection): LifterAxes | null {
  const sex = SEX_CATEGORIES.find((candidate) => candidate === selection.sex);
  const tested = testedFlag(selection);
  const { equipment } = selection;
  if (sex === undefined || tested === null || equipment === null) {
    return null;
  }
  return { sex, equipmentId: equipment, tested };
}

/**
 * One cell of the report: the shared axes plus the two the report walks.
 *
 * Total rather than nullable, because both identifiers come from lists the
 * resolver already filtered against the catalogue. A caller with an id in hand
 * has an id the federation published.
 */
export function lifterCategoryFor(
  axes: LifterAxes,
  weightClassId: string,
  divisionId: string,
): LifterCategory {
  return { ...axes, weightClassId, divisionId };
}

/**
 * Resolves every lift at once.
 *
 * One call for the whole screen rather than one per lift, so that a caller
 * cannot resolve three lifts against one category and the fourth against
 * another -- which is exactly what happens when the total is treated as a
 * special case and given its own call site.
 */
export function resolveStandards(
  book: ClassificationBook | null,
  category: LifterCategory | null,
): readonly LiftStanding[] {
  return LIFTS.map((lift) => ({
    lift,
    label: LIFT_LABELS[lift],
    standards: standardsFor(book, category, lift),
  }));
}

/**
 * Every field read once, with the total added up when it was left blank.
 *
 * Exported because the records panel measures the same four numbers against a
 * different published thing, and deriving the total twice is how the two panels
 * come to disagree about a lifter's total -- one of them rounding a sum the other
 * did not, in a category where nothing on screen says which is which.
 *
 * Written out lift by lift rather than built from `LIFTS` into an accumulator: a
 * `Record<Lift, …>` assembled in a loop needs a cast to start empty, and the cast
 * keeps compiling on the day a fifth lift is added and left unfilled.
 */
export function readLiftEntries(entries: LiftEntries): Readonly<Record<Lift, LiftEntry>> {
  const typed = new Map<Lift, LiftEntry>(
    LIFTS.map((lift) => [lift, readEntry(entries.fields[lift], entries.unit)]),
  );
  const derived = deriveTotal(typed);
  return {
    squat: entryOf(typed, 'squat'),
    bench: entryOf(typed, 'bench'),
    deadlift: entryOf(typed, 'deadlift'),
    total: derived ?? entryOf(typed, 'total'),
  };
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
function readEntry(field: LiftField, unit: WeightUnit): LiftEntry {
  if (field.text.trim() === '') {
    return { kind: 'empty' };
  }
  if (field.weight !== null) {
    // Read from the origin rather than from what is displayed. After a unit change
    // the two differ by the rounding in the text -- 130 kg shows as 286.6 lb, which
    // is 129.99 kg back again -- and it is the number the lifter actually typed
    // that should decide their class, not the number the panel had room to print.
    return { kind: 'weight', kilograms: weightIn(field.weight.origin, 'kg'), derived: false };
  }
  return { kind: 'invalid', message: refusalMessage(parseWeightInput(field.text), unit) };
}

/**
 * Why a field did not read as a weight, in a sentence for the lifter.
 *
 * The domain codes are not shown. They exist so a caller can branch; what a person
 * needs is the correction, and in the unit their own panel is set to -- telling
 * somebody entering pounds to write "142.5" is an instruction to enter a figure
 * that will be read as a different lift entirely.
 */
function refusalMessage(parsed: ParsedWeightInput, unit: WeightUnit): string {
  if (parsed.ok || parsed.code === 'negative') {
    // A successful parse reaches here only for a figure at or below zero, which
    // `originOf` declines. Classifying it would throw, and every standard is a
    // floor above zero, so there is nothing further to say about it.
    return 'Enter a weight above zero.';
  }
  switch (parsed.code) {
    case 'too-large':
      return 'That is heavier than this tool can read.';
    case 'unknown-unit':
      // Worth its own sentence: the figure was fine and only the suffix was not,
      // so repeating the example would look like the number was rejected.
      return 'Write the unit as kg or lb, or leave it off.';
    case 'empty':
    case 'not-a-number':
      break;
  }
  return unit === 'kg'
    ? 'Enter a weight in kilograms, for example 142.5.'
    : 'Enter a weight in pounds, for example 315.';
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
 * A weight as a person writes it: `142.5`, not `142.50`, and `100`, not `100.0`.
 *
 * Trailing zeros read as false precision on a screen full of half-kilogram
 * increments, and `toFixed` alone produces them on every whole number.
 */
export function formatKilograms(kilograms: number): string {
  return String(roundToHundredths(kilograms));
}

/**
 * A published figure, written in the unit the lifter is working in.
 *
 * Pounds get one decimal place where kilograms get two. Not a style choice: every
 * standard is published to the half kilogram, so the hundredths of a converted
 * pound figure are an artifact of 0.45359237 rather than anything the federation
 * wrote down. "10.47 lb to Class I" claims a precision that does not exist and
 * that no bar could be loaded to; "10.5 lb" says the same thing honestly.
 */
export function formatAsUnit(kilograms: number, unit: WeightUnit): string {
  return `${amountAsUnit(kilograms, unit)} ${unit}`;
}

/**
 * The same figure without its unit, for a field that already names one.
 *
 * Separate from {@link formatAsUnit} rather than trimmed off it, because the
 * rounding is the part worth sharing and a caller that re-derived it would drift
 * from the sentence underneath the field it is filling.
 */
export function amountAsUnit(kilograms: number, unit: WeightUnit): string {
  if (unit === 'kg') {
    return formatKilograms(kilograms);
  }
  return String(roundToPlaces(weightIn({ amount: kilograms, unit: 'kg' }, 'lb'), 1));
}

function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}
