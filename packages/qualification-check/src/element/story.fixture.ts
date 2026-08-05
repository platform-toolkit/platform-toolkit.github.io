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
import type {
  AthleteEntry,
  AthleteHistory,
  AthleteMirrorInfo,
  ClassificationTable,
} from '@platform-toolkit/data-contracts';
import { athleteLookupKey } from '@platform-toolkit/data-contracts';

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

/**
 * An archive to search, with none of a real one's details.
 *
 * The host is `.invalid`, which is reserved by RFC 2606 and can never resolve --
 * section 2.1 aside, a fixture naming a live archive is a fixture that documents
 * somebody else's routing, and the panel deliberately encodes no site's routing at all.
 * The counts are invented and are two orders of magnitude below the real mirror's, so
 * that a story cannot be mistaken for a measurement of it.
 */
export function aMirror(patch: Partial<AthleteMirrorInfo> = {}): AthleteMirrorInfo {
  return {
    id: 'invented-archive',
    label: 'The Invented Results Archive',
    attribution: 'Results collected by the Invented Results Archive and used with thanks.',
    sourceUrl: 'https://archive.invalid/',
    scopeNote:
      'This mirror holds meets the archive had transcribed when the site was last built. ' +
      'A meet it has not reached yet will not be here, and neither will a result that was ' +
      'never published.',
    athleteCount: 941,
    entryCount: 5931,
    ...patch,
  };
}

/**
 * One lifter as the archive holds them, keyed the way the archive keys them.
 *
 * The key is computed with the same fold the seam uses rather than typed out, because a
 * hand-written key is a second implementation of `athleteLookupKey` that agrees with it
 * only until one of them changes -- and the whole reason two histories can share a key is
 * that the fold is lossy. The two names below fold to the same key on purpose.
 */
export function aHistory(
  name: string,
  entries: readonly AthleteEntry[] = [entry()],
): AthleteHistory {
  return { key: athleteLookupKey(name) ?? 'invented', name, entries: [...entries] };
}

/**
 * Two people the archive cannot tell apart, which is the case the panel exists for.
 *
 * `Jane Invented` and `Jane Invented #2` fold to different keys -- the digit survives the
 * fold -- so the collision is spelled the way the real corpus spells it: the archive
 * appends a suffix to the *second* person it meets under a name, and both come back from
 * one lookup because the caller searched the name without one. About two and a half
 * thousand of ninety-seven thousand real names do this.
 */
export function twoNamesakes(): readonly AthleteHistory[] {
  return [
    aHistory('Jane Invented'),
    { ...aHistory('Jane Invented'), name: 'Jane Invented #2', entries: [aGearedMeet()] },
  ];
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
