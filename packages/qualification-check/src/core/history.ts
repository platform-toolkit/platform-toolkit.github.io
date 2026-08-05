// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { AthleteEntry } from '@platform-toolkit/data-contracts';

import type {
  BestPerformance,
  CalendarDay,
  ObservedAge,
  ObservedStanding,
  PerformanceSource,
  RegistrationLabels,
  SetAsideResult,
} from '../types.js';
import { windowContains, type PerformanceWindow } from './window.js';

/**
 * Turning a competition history into the registrations it supports.
 *
 * This is the answer to the sharpest line in the brief: "if there are multiple
 * weight classes or drug test statuses for the same lifter in that time period,
 * show all possible qualifications". So nothing here picks a representative
 * standing, sorts by recency, or prefers the heaviest total. A lifter who dropped
 * a class in March and competed tested in June has two standings and gets two,
 * because which one they intend to enter under next is a decision they have not
 * made yet and this tool cannot make for them.
 *
 * Everything below reads the archive's own words and translates none of them
 * (section 5.15). The one column it would be most tempting to parse is `event`:
 * `SBD` looks like three letters naming three lifts, and reading it that way
 * would let this file say "the squat was not contested" instead of "there is no
 * squat here". It is not parsed. The letters are a convention of one archive, the
 * distinction they would buy is available from the figures themselves -- an entry
 * recording all three lifts contested all three -- and a convention read as a
 * grammar is how a `BD` push/pull total ends up graded against a three-lift
 * standard.
 */

/**
 * Place codes that mean the result was struck, not that it was unremarkable.
 *
 * Uppercase, and compared after trimming and folding, because the archive is
 * consistent about these and a stray lower-case one is still the same code.
 *
 * **`G` is deliberately absent.** A guest lifter cannot place or set records at
 * the meet they guest at, and their lifts still count towards entering the next
 * one -- USPA Item 1.1.8, and it is the rule that matters most here, because a
 * screen that treated a guest entry as no entry would under-report exactly the
 * lifter who moved up a class to fill a platform. Numeric placings are absent for
 * the obvious reason and so is every code the archive may add later: the default
 * is that a recorded lift happened.
 */
export const STRUCK_PLACE_CODES: ReadonlySet<string> = new Set(['DQ', 'DD', 'NS']);

/**
 * The separator between the parts of a standing key.
 *
 * Spelled as an escape, never as the literal character (section 2.4), and present
 * at all for the reason `shard-athletes.ts` records: run together, the labels
 * `('Raw', 'Wraps')` and `('RawWraps', '')` are one string, and the second
 * standing disappears into the first leaving a report that is entirely valid and
 * one registration short.
 */
const KEY_SEPARATOR = '\u001F';

/** Every registration the entries inside the window support, keyed and sorted. */
export function collectStandings(
  entries: readonly AthleteEntry[],
  window: PerformanceWindow,
): readonly ObservedStanding[] {
  const grouped = new Map<string, AthleteEntry[]>();

  for (const entry of entries) {
    if (!windowContains(window, entry.date)) continue;
    const key = standingKey(registrationOf(entry));
    const bucket = grouped.get(key);
    if (bucket === undefined) {
      grouped.set(key, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  return [...grouped.entries()]
    .map(([key, bucket]) => buildStanding(key, bucket))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

/** The registration axes of one entry, in the archive's own words. */
export function registrationOf(entry: AthleteEntry): RegistrationLabels {
  return {
    sex: entry.sex,
    equipment: entry.equipment,
    division: entry.division,
    ageClass: entry.ageClass,
    weightClassKg: entry.weightClassKg,
    tested: entry.tested,
    event: entry.event,
  };
}

/**
 * A stable key for one combination of registration labels.
 *
 * `tested` is spelled as three tokens rather than two. Folding "the archive does
 * not say" into "untested" would merge a tested meet nobody annotated with a meet
 * that ran no testing, and drug-test status is what a lifter is turned away at
 * weigh-in over.
 */
export function standingKey(registration: RegistrationLabels): string {
  return [
    registration.sex,
    registration.equipment,
    registration.division ?? '',
    registration.ageClass ?? '',
    registration.weightClassKg ?? '',
    registration.tested === null ? '?' : registration.tested ? 'tested' : 'untested',
    registration.event,
  ].join(KEY_SEPARATOR);
}

function buildStanding(key: string, entries: readonly AthleteEntry[]): ObservedStanding {
  const ordered = [...entries].sort(byDate);
  const counted: AthleteEntry[] = [];
  const setAside: SetAsideResult[] = [];

  for (const entry of ordered) {
    const struck = strikeCode(entry.place);
    if (struck === null) {
      counted.push(entry);
    } else {
      setAside.push({ source: sourceOf(entry), reason: 'disqualified', place: struck });
    }
  }

  // Restricted to entries recording all three lifts. A `total` standard is the sum
  // of three (`LiftSchema`), so a push/pull total read against it hands a lifter a
  // grade they have not reached -- and it is a *heavier* wrong answer than the
  // right one, which is the direction nobody double-checks.
  const fullPower = counted.filter(
    (entry) => entry.squatKg !== null && entry.benchKg !== null && entry.deadliftKg !== null,
  );
  const total = bestOf(fullPower, (entry) => entry.totalKg);
  const anyTotal = bestOf(counted, (entry) => entry.totalKg);

  return {
    key,
    registration: registrationOf(ordered[0] ?? throwEmpty()),
    entries: ordered,
    squat: bestOf(counted, (entry) => entry.squatKg),
    bench: bestOf(counted, (entry) => entry.benchKg),
    deadlift: bestOf(counted, (entry) => entry.deadliftKg),
    total,
    partialTotal:
      anyTotal !== null && (total === null || anyTotal.kilograms > total.kilograms)
        ? anyTotal
        : null,
    ages: distinctAges(counted),
    bodyweights: distinctBodyweights(counted),
    setAside,
  };
}

/** The struck code this place carries, or `null` where the result stands. */
function strikeCode(place: string | null): string | null {
  if (place === null) return null;
  const folded = place.trim().toUpperCase();
  return STRUCK_PLACE_CODES.has(folded) ? folded : null;
}

/**
 * The heaviest figure of one kind, and where it came from.
 *
 * Ties go to the earlier meet, because the entries arrive oldest first and this
 * keeps a strict comparison. That is arbitrary in the sense that both meets are
 * equally true, and deliberate in the sense that the alternative is a report whose
 * cited meet changes when an unrelated result is added.
 */
function bestOf(
  entries: readonly AthleteEntry[],
  read: (entry: AthleteEntry) => number | null,
): BestPerformance | null {
  let best: BestPerformance | null = null;
  for (const entry of entries) {
    const kilograms = read(entry);
    // A null is "no successful lift", never a zero. Comparing against a zero would
    // put a lifter who bombed one lift at the bottom of a ladder they were never on.
    if (kilograms === null) continue;
    if (best === null || kilograms > best.kilograms) {
      best = { kilograms, source: sourceOf(entry) };
    }
  }
  return best;
}

function sourceOf(entry: AthleteEntry): PerformanceSource {
  return {
    on: entry.date,
    meetName: entry.meetName,
    federation: entry.federation,
    parentFederation: entry.parentFederation,
    place: entry.place,
  };
}

/**
 * Every distinct age recorded, keeping the archive's uncertainty.
 *
 * Distinct on the pair, not on the number: 39 and "39 or 40" are two different
 * statements and only one of them settles whether the lifter was a Submaster.
 */
function distinctAges(entries: readonly AthleteEntry[]): readonly ObservedAge[] {
  const seen = new Map<string, ObservedAge>();
  for (const entry of entries) {
    if (entry.age === null) continue;
    const key = `${entry.age.years}${KEY_SEPARATOR}${String(entry.age.approximate)}`;
    if (seen.has(key)) continue;
    seen.set(key, { years: entry.age.years, approximate: entry.age.approximate, on: entry.date });
  }
  return [...seen.values()].sort(
    (left, right) =>
      left.years - right.years || Number(left.approximate) - Number(right.approximate),
  );
}

function distinctBodyweights(entries: readonly AthleteEntry[]): readonly number[] {
  const seen = new Set<number>();
  for (const entry of entries) {
    if (entry.bodyweightKg !== null) seen.add(entry.bodyweightKg);
  }
  return [...seen].sort((left, right) => left - right);
}

function byDate(
  left: { readonly date: CalendarDay },
  right: { readonly date: CalendarDay },
): number {
  return left.date < right.date ? -1 : left.date > right.date ? 1 : 0;
}

/**
 * Unreachable: a group exists because an entry was put in it.
 *
 * Thrown rather than defaulted, because a standing built from no entry would
 * report a registration nobody competed under.
 */
function throwEmpty(): never {
  throw new RangeError('A standing was built from no entries.');
}
