// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What the converter holds between keystrokes, and what it remembers between
 * visits.
 *
 * Pure, like every other tool's session module, and for the same reason: the
 * interesting decisions here are about what happens when somebody reverses the
 * direction halfway through typing, and none of them need a browser to state.
 *
 * THE ENTRY IS AN ORIGIN, NOT A NUMBER
 *
 * Reversing the direction is the single most common thing anybody does with a
 * converter, and the requirements are explicit that reversing must *convert* the
 * current value into the new input unit rather than reinterpret the same digits
 * as the other unit. Done naively -- convert the displayed figure, round it, put
 * it back in the box -- the value drifts a little further from the original on
 * every flick, and after a dozen reversals a lifter's 315 lb is 314.98 lb.
 *
 * So the field is backed by an `EnteredWeight`: what was typed, in the unit it
 * was typed in. Reversing changes which unit it is *shown* in and touches the
 * origin not at all, so fifty reversals return the number they started with,
 * exactly. Typing replaces the origin, because at that point the old value is
 * not the visitor's any more.
 *
 * WHAT IS REMEMBERED AND WHAT IS NOT
 *
 * Direction, the last value, the result precision, the chart step, and the
 * column order. Not whether the full chart is unfolded: tool 2 does not remember
 * a fold and the requirements condition remembering this one on being consistent
 * with the other widgets, so it is not remembered here either.
 *
 * Nothing here can hold free text -- `packages/preferences` has no builder for
 * it (§5.12) -- which is why the remembered value is a bounded number plus the
 * unit it was typed in plus a flag saying whether there was one at all, rather
 * than the contents of the field.
 */
import {
  MAX_WEIGHT_INPUT,
  directionFrom,
  directionInputUnit,
  enterWeight,
  entryAmount,
  parseWeightInput,
  reverseDirection,
  showEntryIn,
  type ConversionDirection,
  type EnteredWeight,
  type WeightUnit,
} from '@platform-toolkit/domain';
import {
  PreferenceValue,
  definePreference,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

/** How the read of the published chart is going. Rendered as three sentences, not one. */
export type ChartStatus = 'loading' | 'ready' | 'unavailable' | 'failed';

/**
 * Which column the full chart leads with.
 *
 * The requirements ask for "pounds-first or kilograms-first order", and on this
 * data that is a question about column order rather than sort order: both columns
 * ascend together, so sorting by one sorts by the other. Modelling it as a sort
 * direction would offer a control that visibly does nothing.
 */
export type ColumnOrder = 'kilograms-first' | 'pounds-first';

/** The unit the leading column is in. */
export function leadingUnit(order: ColumnOrder): WeightUnit {
  return order === 'kilograms-first' ? 'kg' : 'lb';
}

/**
 * How much of the published chart to show, in kilograms of step.
 *
 * `0` means every published row. Every other value thins the *published* rows to
 * those on the step -- it never generates one, which is the rule the whole tool
 * turns on. See `filterRowsByStep`.
 */
export const CHART_STEPS: readonly number[] = [0, 5, 10, 25];

export function chartStepLabel(step: number): string {
  return step === 0 ? 'Every row' : `Every ${String(step)} kg`;
}

/**
 * Precisions offered for the exact mathematical equivalent.
 *
 * Two is the collection's default and the right answer at a rack. Four is for
 * somebody checking the arithmetic, which the requirements ask to be available
 * unobtrusively rather than prominently.
 */
export const RESULT_PRECISIONS: readonly number[] = [2, 4];

export const DEFAULT_PRECISION = 2;

/*
 * ---------------------------------------------------------------------------
 * The field, and what reversing does to it.
 * ---------------------------------------------------------------------------
 */

/** The converter's whole editable state. */
export interface ConverterEntry {
  /** Which way round the conversion is running. */
  readonly direction: ConversionDirection;
  /** Exactly what is in the field. A string until something parses it. */
  readonly text: string;
  /**
   * The drift-free origin behind the field, or `null` when nothing parses.
   *
   * Separate from `text` rather than derived from it, because the two answer
   * different questions: `text` is what the visitor can see and edit, and this is
   * what a reversal converts. A half-typed `12.` has a text and no origin.
   */
  readonly entry: EnteredWeight | null;
}

export const EMPTY_ENTRY: ConverterEntry = {
  direction: 'lb-to-kg',
  text: '',
  entry: null,
};

/**
 * Accepts a keystroke.
 *
 * A unit suffix is honoured, and honouring it can change the direction: somebody
 * who types `100 kg` while converting kilograms *to* pounds has said which unit
 * their number is in, and reinterpreting it as pounds would be the exact mistake
 * the reversal rule exists to prevent. A suffix that matches the current input
 * unit changes nothing.
 *
 * Anything that does not parse leaves the text in place and the origin `null`:
 * the field must always show what was typed, because a visitor cannot correct a
 * character the tool has silently eaten.
 */
export function typeInto(current: ConverterEntry, text: string): ConverterEntry {
  const parsed = parseWeightInput(text);
  if (!parsed.ok) {
    return { ...current, text, entry: null };
  }
  const unit = parsed.unit ?? directionInputUnit(current.direction);
  const direction = parsed.unit === null ? current.direction : directionFrom(parsed.unit);
  return { direction, text, entry: enterWeight(parsed.amount, unit) };
}

/**
 * Reverses the direction, converting what is in the field rather than rereading it.
 *
 * The requirement in one line: "Reversing direction SHALL convert the current
 * input value into the new input unit instead of silently reinterpreting the same
 * number." 315 lb reversed is 142.88 kg, never 315 kg -- which is a hundred and
 * fifty kilograms of difference with nothing on screen to indicate it.
 */
export function reverse(current: ConverterEntry): ConverterEntry {
  const direction = reverseDirection(current.direction);
  if (current.entry === null) {
    // Nothing to carry across. The text is dropped rather than kept, because
    // whatever is in it did not parse and would now be read as the other unit.
    return { direction, text: '', entry: null };
  }
  const shown = showEntryIn(current.entry, directionInputUnit(direction));
  return { direction, text: String(entryAmount(shown)), entry: shown };
}

/** Sets the direction outright, converting the field the same way a reversal does. */
export function setDirection(
  current: ConverterEntry,
  direction: ConversionDirection,
): ConverterEntry {
  return direction === current.direction ? current : reverse(current);
}

/**
 * Puts a specific figure in the field, in the unit currently being typed in.
 *
 * This is what the "select this attempt" actions call. The figure comes from a
 * published row, so the entry it produces lands on an exact chart match -- which
 * is the whole point of offering the action rather than letting somebody retype
 * a number off the screen.
 */
export function selectValue(current: ConverterEntry, amount: number): ConverterEntry {
  return {
    direction: current.direction,
    text: String(amount),
    entry: enterWeight(amount, directionInputUnit(current.direction)),
  };
}

/** Back to an empty field, keeping the direction. Clearing is not a reset of everything. */
export function clearValue(current: ConverterEntry): ConverterEntry {
  return { direction: current.direction, text: '', entry: null };
}

/**
 * The sentence to show under the field, or `null` when there is nothing wrong.
 *
 * An empty field is deliberately not a problem. It is where every visit starts,
 * and an error there would be the tool telling somebody off for opening it.
 */
export function entryProblem(current: ConverterEntry): string | null {
  return weightProblem(current.text);
}

/**
 * The same judgement for any weight field, given only its text.
 *
 * Shared with the full chart's search box rather than written twice: two fields
 * that read the same input and disagree about whether it is acceptable is a bug
 * nobody looks for, because each one is right on its own.
 */
export function weightProblem(text: string): string | null {
  if (text.trim() === '') return null;
  const parsed = parseWeightInput(text);
  if (parsed.ok) return null;
  switch (parsed.code) {
    case 'empty':
      return null;
    case 'negative':
      return 'Enter a weight above zero.';
    case 'too-large':
      return `Enter a weight of ${MAX_WEIGHT_INPUT.toLocaleString('en-US')} or less.`;
    case 'unknown-unit':
      return 'Enter a weight in pounds or kilograms, for example 315 lb.';
    case 'not-a-number':
      return 'Enter a weight using digits, for example 315.';
  }
}

/*
 * ---------------------------------------------------------------------------
 * What survives a refresh.
 * ---------------------------------------------------------------------------
 */

/**
 * The remembered value, and whether there was one.
 *
 * Three fields where two look sufficient, and the third is the one that matters.
 * `unit` is the unit the number was *typed* in and `shownIn` is the unit it is
 * currently being read in, and after a reversal those differ -- the origin is
 * never rewritten, which is the whole basis of the drift-free field. Storing
 * only the origin brings back 315 lb with the direction reset; storing only the
 * displayed figure brings back a rounded 142.88 kg and starts the drift the type
 * exists to prevent. Both, and a reload is exactly where the visitor left off.
 *
 * The `present` flag is not redundant with a zero amount either: zero is a
 * legitimate thing to convert -- the requirements say so explicitly -- so
 * encoding "empty" as zero, the way tool 2's weights do, would turn a typed `0`
 * into an empty field on the next visit.
 */
interface StoredValue {
  readonly amount: number;
  /** The unit it was typed in. Never rewritten. */
  readonly unit: WeightUnit;
  /** The unit it is currently displayed in. Differs after a reversal. */
  readonly shownIn: WeightUnit;
  readonly present: boolean;
}

export const CONVERTER_PREFERENCES = {
  direction: definePreference<ConversionDirection>({
    name: 'convert.direction',
    // Spelled inline rather than through a named constant: `choice` infers its
    // literal union from a `const` type parameter, and a value annotated
    // `readonly [string, ...string[]]` widens it back to `string` -- which then
    // fails to satisfy the explicit `ConversionDirection` above.
    value: PreferenceValue.choice(['lb-to-kg', 'kg-to-lb']),
    // Pounds to kilograms, because the audience is largely American and the
    // question at a meet is almost always "what do I put on my attempt card".
    fallback: 'lb-to-kg',
  }),
  value: definePreference<StoredValue>({
    name: 'convert.value',
    value: PreferenceValue.shape({
      // Bounded because `packages/preferences` requires it, and requires it for a
      // reason: a corrupted `1e308` read back here would make every figure on the
      // screen `Infinity`. The bound is the parser's own, so a value that reached
      // the field can always be stored.
      amount: PreferenceValue.quantity({ min: 0, max: MAX_WEIGHT_INPUT }),
      unit: PreferenceValue.choice(['lb', 'kg']),
      shownIn: PreferenceValue.choice(['lb', 'kg']),
      present: PreferenceValue.flag(),
    }),
    fallback: { amount: 0, unit: 'lb', shownIn: 'lb', present: false },
  }),
  precision: definePreference<number>({
    name: 'convert.precision',
    value: PreferenceValue.count({ min: 2, max: 4 }),
    fallback: DEFAULT_PRECISION,
  }),
  step: definePreference<number>({
    name: 'convert.chart-step',
    value: PreferenceValue.count({ min: 0, max: 25 }),
    fallback: 0,
  }),
  order: definePreference<ColumnOrder>({
    name: 'convert.column-order',
    value: PreferenceValue.choice(['kilograms-first', 'pounds-first']),
    fallback: 'kilograms-first',
  }),
};

/** Everything the converter reads back on start-up. */
export interface ConverterSettings {
  readonly entry: ConverterEntry;
  readonly precision: number;
  readonly step: number;
  readonly order: ColumnOrder;
}

export function loadSettings(store: PreferenceStore): ConverterSettings {
  const direction = store.read(CONVERTER_PREFERENCES.direction);
  const stored = store.read(CONVERTER_PREFERENCES.value);
  const precision = store.read(CONVERTER_PREFERENCES.precision);
  const step = store.read(CONVERTER_PREFERENCES.step);
  const order = store.read(CONVERTER_PREFERENCES.order);

  return {
    entry: restoreEntry(direction, stored),
    precision: RESULT_PRECISIONS.includes(precision) ? precision : DEFAULT_PRECISION,
    step: CHART_STEPS.includes(step) ? step : 0,
    order,
  };
}

/**
 * Rebuilds the field from what was stored.
 *
 * The direction comes from the stored `shownIn` rather than from the direction
 * preference, and only falls back to that preference when there is no value to
 * show. The two are written together and can only disagree if one landed and the
 * other did not -- at which point believing the direction would put a pound
 * figure under a kilogram label, which is the failure the entry model exists to
 * prevent, and it would be a plausible-looking screen with nothing to indicate it.
 */
function restoreEntry(direction: ConversionDirection, stored: StoredValue): ConverterEntry {
  if (!stored.present) {
    return { direction, text: '', entry: null };
  }
  const entry = showEntryIn(enterWeight(stored.amount, stored.unit), stored.shownIn);
  return {
    direction: directionFrom(stored.shownIn),
    text: String(entryAmount(entry)),
    entry,
  };
}

/**
 * Writes the field back.
 *
 * A write that violates its own definition throws by design (§5.12), which is
 * right for a caller bug and wrong here: this runs on every keystroke, so half
 * the values are mid-edit. An unparseable field stores "nothing entered" rather
 * than clamping to a number nobody typed.
 */
export function saveEntry(store: PreferenceStore, entry: ConverterEntry): void {
  store.write(CONVERTER_PREFERENCES.direction, entry.direction);
  const shownIn = directionInputUnit(entry.direction);
  const held = entry.entry;
  // Range-checked rather than trusted, even though the parser applies the same
  // bound: the entry can also arrive from `selectValue`, and a write that
  // violates its definition throws -- which on a keystroke path takes the screen
  // down over a number nobody will miss.
  const storable =
    held !== null && held.origin.amount >= 0 && held.origin.amount <= MAX_WEIGHT_INPUT;
  store.write(
    CONVERTER_PREFERENCES.value,
    storable
      ? { amount: held.origin.amount, unit: held.origin.unit, shownIn: held.shownIn, present: true }
      : { amount: 0, unit: shownIn, shownIn, present: false },
  );
}
