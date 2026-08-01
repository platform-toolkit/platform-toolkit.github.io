import type { WeightUnit } from './weight.js';

/**
 * Reading a weight out of whatever a person typed.
 *
 * There is already a parser in `units.ts` (`parseKilograms`) and it is not this
 * one: that reads a figure out of a federation's published document, where the
 * input is a machine's output and anything unexpected is a data bug. This reads a
 * text field on a phone, where the input is a thumb, and the interesting cases are
 * `1o5`, a half-typed `12.`, a pasted `1,000`, and `183.7 kg` copied out of a
 * message from a coach.
 *
 * Two rules shape the whole file:
 *
 *   - **Refuse rather than interpret.** `1,5` is one and a half to most of Europe
 *     and malformed to the rest, and there is no way to tell from the string which
 *     was meant. A tool that guesses turns 1.5 kg into 15 kg silently. So a comma
 *     is only ever a group separator, only in groups of exactly three, and
 *     anything else is rejected with a code the interface can explain.
 *   - **A code, not a sentence.** The wording of an error belongs to the screen
 *     showing it -- the same bad input needs different phrasing in the main field
 *     and in a chart search box -- and a domain that returns prose cannot be
 *     rendered twice.
 */

/** Why a typed weight could not be read. */
export type WeightInputProblem =
  /** Nothing typed yet. Not a mistake, and interfaces should stay quiet about it. */
  | 'empty'
  /** Not a number this parser will accept. Covers `1o5`, `1,5`, `--3`, `1.2.3`. */
  | 'not-a-number'
  /** A negative figure. There is no negative barbell. */
  | 'negative'
  /** Past the bound below. */
  | 'too-large'
  /** A unit suffix that is neither kilograms nor pounds. */
  | 'unknown-unit';

export type ParsedWeightInput =
  | {
      readonly ok: true;
      readonly amount: number;
      /**
       * The unit written after the number, or `null` if none was.
       *
       * `null` means "the visitor did not say", which is a different thing from a
       * default: the caller knows which unit its field is currently in and only it
       * can decide. A typed suffix that disagrees with the field is a real signal
       * -- somebody pasting `183.7 kg` into a pound field means the kilograms.
       */
      readonly unit: WeightUnit | null;
    }
  | { readonly ok: false; readonly code: WeightInputProblem };

/**
 * The largest figure this will read.
 *
 * A converter has no business imposing a barbell-sized ceiling -- people convert
 * bodyweights, shipments and equipment loads -- so this is set far above anything
 * plausible rather than at anything meaningful. It exists because the value is
 * remembered, and a remembered preference must carry bounds (see
 * `packages/preferences`): without one, a corrupted `1e308` comes back out of
 * storage and every derived figure on the screen is `Infinity`.
 */
export const MAX_WEIGHT_INPUT = 100_000;

/**
 * A plain decimal, optionally with three-digit groups.
 *
 * Written as alternatives rather than one clever pattern so each shape is legible:
 * grouped (`1,234.5`), ungrouped (`1234.5`), and leading-point (`.5`, which a
 * numeric keypad makes easy to produce and which nobody means as an error).
 */
const NUMBER_PATTERN = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/u;

/**
 * Spellings accepted after a number.
 *
 * Generous on the way in and lossless on the way out: every one of these maps to
 * one of the two units the collection has, so no caller ever sees a third.
 */
const UNIT_SPELLINGS = new Map<string, WeightUnit>([
  ['kg', 'kg'],
  ['kgs', 'kg'],
  ['kilo', 'kg'],
  ['kilos', 'kg'],
  ['kilogram', 'kg'],
  ['kilograms', 'kg'],
  ['lb', 'lb'],
  ['lbs', 'lb'],
  ['pound', 'lb'],
  ['pounds', 'lb'],
]);

/** Splits a trailing unit off the number, if there is one. */
const SUFFIXED = /^(?<number>[^a-z]*?)\s*(?<unit>[a-z]+)$/u;

/**
 * Reads a weight, and the unit it was written in if one was.
 *
 * Total: every string produces an answer, and the failures are enumerated rather
 * than thrown, because "the visitor is mid-keystroke" is the normal state of a
 * text field and not an exceptional one.
 */
export function parseWeightInput(text: string): ParsedWeightInput {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, code: 'empty' };
  }

  // Lower-cased once, for the suffix only. The digits are unaffected, and doing it
  // here rather than per-comparison means `KG` and `Kg` cannot be handled in two
  // places that later disagree.
  const normalized = trimmed.toLowerCase();

  // A leading minus is caught before the number pattern so that it reports as a
  // negative rather than as gibberish. The two need different wording: one is a
  // typo, the other is a person who has understood the field and asked for
  // something it does not do.
  if (normalized.startsWith('-')) {
    return { ok: false, code: 'negative' };
  }

  let numberPart = normalized;
  let unit: WeightUnit | null = null;

  const suffixed = SUFFIXED.exec(normalized);
  const digits = suffixed?.groups?.['number']?.trim() ?? '';
  // A trailing word is only read as a unit when there is a number in front of it.
  // Otherwise a bare `kg` -- or `abc` -- reports as an unrecognised unit, which
  // tells somebody who has typed nothing numeric that their *unit* is the problem.
  if (suffixed !== null && digits !== '') {
    const spelling = suffixed.groups?.['unit'];
    const found = spelling === undefined ? undefined : UNIT_SPELLINGS.get(spelling);
    if (found === undefined) {
      return { ok: false, code: 'unknown-unit' };
    }
    unit = found;
    numberPart = digits;
  }

  if (!NUMBER_PATTERN.test(numberPart)) {
    return { ok: false, code: 'not-a-number' };
  }

  // Group separators are removed only after the pattern has vouched for their
  // placement, so `1,5,0` cannot reach here and become 150.
  const amount = Number(numberPart.replaceAll(',', ''));
  if (!Number.isFinite(amount)) {
    // Unreachable through the pattern above, which admits no exponent and no
    // infinity spelling -- but a parse that returns a non-finite number is the one
    // failure that poisons every figure downstream, so it is checked rather than
    // reasoned about.
    return { ok: false, code: 'not-a-number' };
  }
  if (amount > MAX_WEIGHT_INPUT) {
    return { ok: false, code: 'too-large' };
  }

  return { ok: true, amount, unit };
}
