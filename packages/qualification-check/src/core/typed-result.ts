// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { AthleteEntry } from '@platform-toolkit/data-contracts';
import { formatPlainDate, parseKilograms, parsePlainDate } from '@platform-toolkit/domain';

/**
 * A result somebody types in, read as the same thing an archive would have given.
 *
 * This is the whole of way three's input, and the shape it produces is the
 * decision worth defending: an {@link AthleteEntry}, identical to a mirrored one,
 * rather than a hand-built standing. The brief calls the no-archive case "the
 * common case" and says it "must be the best-designed screen, not the fallback",
 * and the cheapest way to make a fallback feel like one is to give it its own
 * half-featured pipeline.
 *
 * So it does not get one. A typed result goes through `collectStandings` like any
 * other, which means every rule already written applies to it for free and cannot
 * drift: the standing grouping, the struck-place rule, the three-lift restriction
 * on a total, the route window, the `federation-not-named` sift, the tested sift.
 * A lifter who types two results a class apart gets two registrations for the same
 * reason an imported lifter does. A screen that mixed both origins -- an imported
 * history plus one meet the mirror is missing -- needs no code at all beyond
 * concatenating the arrays.
 *
 * WHAT IT REFUSES TO INVENT
 *
 * Every field of an entry is either asked for or derived from what was asked for.
 * Nothing is guessed and nothing is defaulted to a plausible value, because the
 * output is indistinguishable from published data the moment it is built -- and a
 * synthetic meet name or an assumed parent federation would then be cited on
 * screen as though somebody had recorded it. `parentFederation` and `place` are
 * `null` here for exactly the reason the contract says `null` means: the source
 * did not say. The source is a person filling in a form, and they were not asked.
 *
 * Nothing in this file touches a clock, a network, or the DOM (section 15).
 */

/** Which field a problem belongs to, so a form can mark the control that caused it. */
export type TypedResultField =
  | 'date'
  | 'meetName'
  | 'federation'
  | 'sex'
  | 'equipment'
  | 'ageYears'
  | 'bodyweightKg'
  | 'squatKg'
  | 'benchKg'
  | 'deadliftKg'
  /** Not a control. The three lift fields together, none of which was filled in. */
  | 'lifts';

/** What is wrong with one field. */
export type TypedResultProblemCode =
  /** Required and left blank. */
  | 'missing'
  | 'unreadable-date'
  | 'unreadable-number'
  /** A weight of zero. A missed lift is a blank field, never a nought. */
  | 'not-above-zero'
  | 'not-a-whole-number'
  /** No squat, bench or deadlift was given, so there is no result to record. */
  | 'no-lift';

export interface TypedResultProblem {
  readonly field: TypedResultField;
  readonly code: TypedResultProblemCode;
}

/**
 * What the form knows about drug testing at that meet.
 *
 * Three values and not a checkbox, mirroring `AthleteEntry.tested` exactly. A
 * checkbox has no way to say "I do not know", so an unticked box would arrive as a
 * claim the meet ran no testing -- and drug-test status is the axis a lifter is
 * turned away at weigh-in over.
 */
export type TypedTestedAnswer = 'tested' | 'untested' | 'unstated';

/**
 * The form, as strings.
 *
 * Strings throughout, including the numbers, for `ptk-number-field`'s reason: a
 * field that parses as you type has to decide what `12.` means mid-keystroke, and
 * every answer either fights the caret or discards what was typed. Parsing happens
 * once, here, when the result is submitted.
 */
export interface TypedResultForm {
  /** `YYYY-MM-DD`, from `ptk-date-field`. */
  readonly date: string;
  readonly meetName: string;

  /**
   * The sanctioning body, spelled as the meet's own results sheet spells it.
   *
   * Spelling is load-bearing here in a way it is nowhere else in this package: a
   * route that names the federations it accepts is matched on the folded string
   * (`namesFederation`), which forgives case and punctuation and nothing else.
   */
  readonly federation: string;

  /**
   * The body the sanctioning federation belongs to, or blank where none is named.
   *
   * Asked separately rather than inferred, and worth a control of its own because
   * it is the difference between a result counting and being set aside: a route
   * naming the parent will disregard an affiliate meet that only names itself. A
   * lifter can see that reason on screen and answer it; nothing this tool could
   * infer would be checkable.
   */
  readonly parentFederation: string;

  /** In the meet's own words, as the archive would print it: `M`, `F`, `Mx`. */
  readonly sex: string;

  /** In the meet's own words: `Raw`, `Wraps`, `Single-ply`. */
  readonly equipment: string;

  /** The division as entered, or blank. */
  readonly division: string;

  /** The meet's own age division, such as `40-44`, or blank. */
  readonly ageClass: string;

  /** Whole years on the day, or blank. */
  readonly ageYears: string;

  /** `true` when the lifter was either {@link ageYears} or a year older. */
  readonly ageApproximate: boolean;

  readonly tested: TypedTestedAnswer;

  /** Weighed-in bodyweight, or blank. */
  readonly bodyweightKg: string;

  /** The class as printed -- `90`, `90+`, `SHW` -- or blank. */
  readonly weightClassKg: string;

  /** Best of three. Blank for a lift that was not contested or was not made. */
  readonly squatKg: string;
  readonly benchKg: string;
  readonly deadliftKg: string;
}

export type TypedResultReading =
  | { readonly ok: true; readonly entry: AthleteEntry }
  | { readonly ok: false; readonly problems: readonly TypedResultProblem[] };

/** A blank form, so a caller never has to spell the field list to open one. */
export function emptyTypedResult(): TypedResultForm {
  return {
    date: '',
    meetName: '',
    federation: '',
    parentFederation: '',
    sex: '',
    equipment: '',
    division: '',
    ageClass: '',
    ageYears: '',
    ageApproximate: false,
    tested: 'unstated',
    bodyweightKg: '',
    weightClassKg: '',
    squatKg: '',
    benchKg: '',
    deadliftKg: '',
  };
}

/**
 * Reads a filled-in form, or reports everything wrong with it at once.
 *
 * Every problem, not the first (section 5.5). Somebody entering a meet is filling
 * this in from a results sheet on a phone, and a form that surfaces one fault per
 * submission makes them do that six times to discover six blanks.
 */
export function readTypedResult(form: TypedResultForm): TypedResultReading {
  const problems: TypedResultProblem[] = [];

  const date = readDay(form.date, problems);
  const meetName = readRequired(form.meetName, 'meetName', problems);
  const federation = readRequired(form.federation, 'federation', problems);
  const sex = readRequired(form.sex, 'sex', problems);
  const equipment = readRequired(form.equipment, 'equipment', problems);

  const ageYears = readWholeYears(form.ageYears, problems);
  const bodyweightKg = readWeight(form.bodyweightKg, 'bodyweightKg', problems);
  const squatKg = readWeight(form.squatKg, 'squatKg', problems);
  const benchKg = readWeight(form.benchKg, 'benchKg', problems);
  const deadliftKg = readWeight(form.deadliftKg, 'deadliftKg', problems);

  const lifts = [squatKg, benchKg, deadliftKg];
  // Checked on the parsed values rather than the raw strings, so a form holding
  // one unreadable lift and nothing else is reported as an unreadable number and
  // not additionally accused of being empty.
  if (lifts.every((lift) => lift === null) && !problems.some(concernsALift)) {
    problems.push({ field: 'lifts', code: 'no-lift' });
  }

  if (problems.length > 0) return { ok: false, problems };

  // Unreachable: each of these is `null` only when a problem was pushed for it,
  // and a problem would have returned above. Narrowed with a guard rather than an
  // assertion because section 2.4 forbids the assertion, and thrown rather than
  // reported because `{ ok: false, problems: [] }` is a refusal with nothing wrong
  // in it -- a form a lifter could never satisfy and no message to say why.
  if (date === null || meetName === null || federation === null) throwUnreachable();
  if (sex === null || equipment === null) throwUnreachable();

  return {
    ok: true,
    entry: {
      date,
      federation,
      parentFederation: optional(form.parentFederation),
      meetName,
      event: eventLetters(squatKg, benchKg, deadliftKg),
      equipment,
      division: optional(form.division),
      ageClass: optional(form.ageClass),
      age: ageYears === null ? null : { years: ageYears, approximate: form.ageApproximate },
      tested: form.tested === 'unstated' ? null : form.tested === 'tested',
      sex,
      bodyweightKg,
      weightClassKg: optional(form.weightClassKg),
      squatKg,
      benchKg,
      deadliftKg,
      totalKg: sumOfLifts(lifts),
      // A typed result carries no placing. There is no field for one, and there
      // should not be: the only placings this package reads are the struck codes,
      // and asking somebody to declare their own result disqualified is asking a
      // question whose honest answer nobody types. A result the meet struck is one
      // the lifter has to leave out, which is the same thing the archive route
      // would have told them and a great deal clearer than a `DQ` picker.
      place: null,
    },
  };
}

/** Whether a problem already reported concerns one of the three lift fields. */
function concernsALift(problem: TypedResultProblem): boolean {
  return (
    problem.field === 'squatKg' || problem.field === 'benchKg' || problem.field === 'deadliftKg'
  );
}

/**
 * The archive's own letters for the lifts that were contested.
 *
 * `history.ts` refuses to *parse* this column, on the grounds that letters are one
 * archive's convention and reading them as a grammar is how a push/pull total gets
 * graded against a three-lift standard. Writing them is the other direction and is
 * safe for the reason that makes reading them unsafe: here the figures are the
 * source and the letters are derived from them, so the two cannot disagree.
 *
 * It matters at all because `event` is part of a standing's key -- a bench-only day
 * and a full meet are two registrations, and merging them would put a single-lift
 * result in the same row as a three-lift one.
 */
function eventLetters(squat: number | null, bench: number | null, deadlift: number | null): string {
  return [squat === null ? '' : 'S', bench === null ? '' : 'B', deadlift === null ? '' : 'D'].join(
    '',
  );
}

/**
 * The sum of the lifts given, or `null` where none was.
 *
 * Derived rather than asked for, so a mistyped total cannot exist. And summed over
 * whatever was given rather than only over all three, because deciding whether a
 * sum counts as a *total* is `buildStanding`'s job and it already does it: an entry
 * missing a lift lands in `partialTotal`, labelled as not a three-lift total, which
 * is precisely what a push/pull result is.
 */
function sumOfLifts(lifts: readonly (number | null)[]): number | null {
  const made = lifts.filter((lift) => lift !== null);
  // A backstop, and knowingly an unreachable one: the only caller refuses a form
  // with no lift in it several lines earlier, so nothing can arrive here empty and
  // no test can make it. Replacing the filter above with a zero-fill therefore
  // passes the whole suite -- the mutation is equivalent under today's caller, not
  // uncovered, and it is recorded here rather than papered over with a test that
  // reaches a private function through a hole cut for it. What the branch is for is
  // the day the `no-lift` check moves or grows a condition: without it an entry
  // would carry `totalKg: 0`, and nought is not a weight anybody lifted. The
  // contract spells "no total" `null`, and a nought would be graded as a total.
  if (made.length === 0) return null;
  const sum = made.reduce((running, lift) => running + lift, 0);
  // Rounded to the hundredth, and the rounding is not decorative. A meet loaded in
  // pounds and recorded in kilograms produces exactly the parts that break: 275,
  // 185 and 335 lb convert to 124.74, 83.91 and 151.95, and those three sum to
  // 360.59999999999997 in binary floating point. That is the figure that would
  // reach a screen whose entire purpose is to be held up against a piece of paper,
  // next to the 360.6 the paper says. A hundredth of a kilogram is finer than any
  // federation's smallest plate, so nothing real is lost by rounding there.
  return Math.round(sum * 100) / 100;
}

function readDay(raw: string, problems: TypedResultProblem[]): string | null {
  if (raw.trim() === '') {
    problems.push({ field: 'date', code: 'missing' });
    return null;
  }
  const parsed = parsePlainDate(raw);
  if (!parsed.ok) {
    problems.push({ field: 'date', code: 'unreadable-date' });
    return null;
  }
  // Re-emitted from the parse rather than passed through, so what leaves here is
  // built from the checked value and not from the string that was typed. What
  // makes it matter is downstream: `windowContains` compares days as strings, and
  // lexical order is chronological order only for a padded `YYYY-MM-DD` -- hand it
  // `2026-3-14`, which sorts *after* `2026-10-01`, and a lifter is told a result
  // falls outside a window it is squarely inside. The refusal above is what
  // actually stops that (the pattern demands two digits); this line only
  // guarantees that nothing between the check and the entry can undo it.
  return formatPlainDate(parsed.date);
}

function readRequired(
  raw: string,
  field: TypedResultField,
  problems: TypedResultProblem[],
): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    problems.push({ field, code: 'missing' });
    return null;
  }
  return trimmed;
}

/** A weight, or `null` for a field left blank. Blank is legal; nonsense is not. */
function readWeight(
  raw: string,
  field: TypedResultField,
  problems: TypedResultProblem[],
): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parsed = parseKilograms(trimmed);
  if (!parsed.ok) {
    problems.push({ field, code: 'unreadable-number' });
    return null;
  }
  if (parsed.kilograms <= 0) {
    // `parseKilograms` accepts a nought and the contract does not. Kept apart from
    // the unreadable case because they want different sentences: a nought is
    // usually somebody recording a missed lift, and the answer is to leave it blank.
    problems.push({ field, code: 'not-above-zero' });
    return null;
  }
  return parsed.kilograms;
}

/** Whole years, or `null` for a field left blank. */
function readWholeYears(raw: string, problems: TypedResultProblem[]): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  if (!/^\d+$/u.test(trimmed)) {
    // A half year is what the archive writes for "one of these two", and it is
    // carried on the entry as `approximate` rather than as a fraction. Somebody
    // typing 23.5 means that, and the tick box is where they say it.
    problems.push({ field: 'ageYears', code: 'not-a-whole-number' });
    return null;
  }
  return Number(trimmed);
}

/** A blank optional field is the source not saying, which the contract spells `null`. */
function optional(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function throwUnreachable(): never {
  throw new RangeError('A required field was empty and reported no problem.');
}
