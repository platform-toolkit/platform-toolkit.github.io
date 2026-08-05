// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The one builder every story in this directory renders from.
 *
 * Not a set of hand-written literals. A `StandingReport` typed out by hand is free to
 * hold a page the core would never produce -- a First Class squat under an ungraded
 * total, a division the vocabulary does not publish, a best lift from a meet outside
 * the window -- and those are exactly the pages a reviewer would stop on, because they
 * look wrong and are meant to look right. So every value below is the fixture archive
 * walked through `collectStandings`, `proposeRegistration` and `gradeStanding`, the same
 * functions the tool calls, and a change to any of them moves the stories with it.
 *
 * Excluded from the package build by the `*.fixture.ts` pattern in `tsconfig.json`, and
 * type-checked by `tsconfig.tests.json`, which is what makes it safe to import the core
 * fixture from here: neither file reaches `dist`, so nothing a consumer installs carries
 * an invented federation's numbers.
 *
 * Every figure is invented (section 5.1). No story anywhere in this collection may print
 * a real federation's published standard.
 */
import {
  TABLES_FIXTURE,
  VOCABULARY_FIXTURE,
  entry,
  meet,
  meetBook,
  wholeYearWindow,
} from '../core/qualification.fixture.js';
import { readMeetCriteria } from '../core/criteria.js';
import { collectStandings } from '../core/history.js';
import { proposeRegistration, resolveRegistration } from '../core/registration.js';
import { gradeStanding } from '../core/standing.js';
import type { AthleteEntry, ClassificationTable } from '@platform-toolkit/data-contracts';

import type {
  MeetReading,
  ObservedStanding,
  ResolvedRegistration,
  StandingReport,
} from '../types.js';

export { TABLES_FIXTURE, VOCABULARY_FIXTURE, entry, meet, meetBook };

/**
 * A day inside the fixture meet's entry window.
 *
 * A literal, not the clock. A story that read the clock would document a different
 * screen every time it was opened, and would start showing "Entry closed" as a change to
 * whatever was committed the week the fixture meet's deadline passed.
 */
export const A_DAY_BEFORE_ENTRY_CLOSES = '2026-08-05';

/** A second competition result, a class up and geared, for the two-standing stories. */
export function aGearedMeet(): AthleteEntry {
  return entry({
    meetName: 'Invented Autumn Classic',
    date: '2026-09-20',
    equipment: 'Single-ply',
    bodyweightKg: 104.2,
    weightClassKg: '112',
    squatKg: 250,
    benchKg: 165,
    deadliftKg: 260,
    totalKg: 675,
  });
}

/** One lifter's best lifts, as the tool observes them from an archive. */
export function aStanding(entries: readonly AthleteEntry[] = [entry()]): ObservedStanding {
  const [standing] = collectStandings(entries, wholeYearWindow());
  if (standing === undefined) {
    throw new Error('The fixture archive produced no standing.');
  }
  return standing;
}

/**
 * The registration those results imply, completed with the answers nobody else can give.
 *
 * The overrides are how a story asks for a *different* reading of the same results --
 * `{ divisionId: 'master-1' }` is the Masters story, and it is the same lifter, the same
 * lifts and a different table. Passing a whole registration instead would let a story
 * quietly grade against a category the results never supported.
 */
export function aRegistration(
  overrides: Partial<ResolvedRegistration> = {},
  standing: ObservedStanding = aStanding(),
): ResolvedRegistration {
  const answers: Partial<ResolvedRegistration> = { sex: 'male', equipmentId: 'raw', ...overrides };
  // The same answers into both calls, which is how the tool itself does it. A ladder of
  // weight classes is published per sex, so a proposal made without the sex answer
  // settles no class -- and passing them only to `resolveRegistration` would make every
  // story in this directory throw on a missing weight class.
  const resolution = resolveRegistration(
    proposeRegistration(standing, VOCABULARY_FIXTURE, answers),
    answers,
  );
  if (!resolution.ok) {
    throw new Error(`The fixture registration is missing ${resolution.missing.join(', ')}.`);
  }
  return resolution.registration;
}

/**
 * What the reader is asked, given what they have answered so far.
 *
 * The answers are a parameter because one axis genuinely depends on another: weight
 * classes are published per sex, so a story that wants a populated class picker has to
 * say which sex it is showing. Defaulted to none, which is the blank form.
 */
export function aProposal(
  standing: ObservedStanding = aStanding(),
  answers: Partial<ResolvedRegistration> = {},
) {
  return proposeRegistration(standing, VOCABULARY_FIXTURE, answers);
}

/**
 * Four grades against one registration.
 *
 * The tables are a parameter, defaulted, so that a story can pass none. A consumer
 * reading one partition at a time has exactly that -- an empty list and a request in
 * flight -- and the panel it produces is the one `standardsStatus` exists to caption.
 */
export function aReport(
  overrides: Partial<ResolvedRegistration> = {},
  standing: ObservedStanding = aStanding(),
  tables: readonly ClassificationTable[] = TABLES_FIXTURE,
): StandingReport {
  return gradeStanding(standing, aRegistration(overrides, standing), tables);
}

/** One meet's published criteria, read against those same results. */
export function aMeetReading(
  overrides: Partial<ResolvedRegistration> = {},
  standing: ObservedStanding = aStanding(),
): MeetReading {
  const book = meetBook();
  const [only] = book.meets;
  return readMeetCriteria(only ?? meet(), standing, aRegistration(overrides, standing), {
    tables: TABLES_FIXTURE,
    vocabulary: VOCABULARY_FIXTURE,
    rules: book.federations[0] ?? null,
  });
}
