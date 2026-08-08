// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  QualificationSourceError,
  buildQualifyingMeetBook,
  type PublishedStandardIds,
} from './qualification.js';

/**
 * An invented federation's transcribed criteria.
 *
 * Every identifier, date and category name here is made up, for the reason §5.1
 * gives and with the addition this corpus forces: a fixture holding a real meet's
 * criteria is a second copy of a page that is edited in place, and it would keep
 * asserting a closed qualifying window long after the announcement moved on.
 */
const STANDARDS: PublishedStandardIds = new Map([
  ['invented', new Set(['invented-class', 'invented-elite'])],
]);

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'invented',
    label: 'Invented Federation',
    provenance: {
      id: 'invented-qualification',
      label: 'Invented Federation qualification criteria',
      document: 'Invented Federation Rulebook',
      url: 'https://example.test/rulebook',
      sections: ['5.1.10 (a)'],
      retrievedAt: '2026-08-05T00:00:00.000Z',
    },
    rulebook: {
      revision: '2026v1',
      // Sixty-four hex characters, invented. A real digest here would be a second
      // copy of a pin that only one file is allowed to own.
      sha256: 'a'.repeat(64),
      url: 'https://example.test/rulebook',
    },
    entryRules: {
      weightClass: {
        mayMoveUp: true,
        moveUpRequiresHigherStandard: true,
        mayMoveDown: false,
        moveUpRequiresVacancy: true,
        quotation:
          'A lifter may move up one class with that class total and a place on the roster.',
      },
      gearLadder: [
        { competedIn: 'Invented Raw', standardReachedIn: 'Invented Raw', opens: ['Invented Raw'] },
        {
          competedIn: 'Invented Raw',
          standardReachedIn: 'Invented Ply',
          opens: ['Invented Raw', 'Invented Ply'],
        },
      ],
      testedCrossoverAllowed: null,
      conditions: [],
    },
    meets: [meet()],
    ...overrides,
  };
}

function meet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'invented-championship-2027',
    label: 'Invented Federation Championship 2027',
    sanctionedBy: 'Invented Federation',
    held: { from: '2027-01-16', to: '2027-01-17' },
    location: 'Invented Hall, Nowhere',
    sanctionNumber: null,
    offerings: [{ discipline: 'Full Power', equipment: ['Invented Raw'] }],
    testedOffering: 'both',
    entryClosesOn: '2027-01-02',
    entry: { kind: 'standard', routes: [route()] },
    conditions: [],
    source: {
      label: 'Invented Federation Championship 2027',
      url: 'https://example.test/championship-2027/',
      verifiedOn: '2026-08-05',
    },
    ...overrides,
  };
}

function route(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'class-total',
    label: 'Class total',
    standard: {
      kind: 'classification',
      standardId: 'invented-class',
      orAbove: true,
      lift: 'total',
      divisionBasis: 'lifters-age-division',
    },
    performance: {
      federationNames: null,
      tested: null,
      territory: null,
      description: 'From an Invented Federation event.',
    },
    window: { from: '2026-01-01', to: '2026-12-31' },
    appliesToTested: null,
    quotation: 'An Invented Class total or above is required to qualify.',
    availability: null,
    dispute: null,
    ...overrides,
  };
}

/** The problems a build reports, or an empty list where it succeeded. */
function problemsFrom(documents: readonly unknown[], standards = STANDARDS): readonly string[] {
  try {
    buildQualifyingMeetBook(documents, standards);
    return [];
  } catch (error) {
    if (error instanceof QualificationSourceError) return error.problems;
    throw error;
  }
}

describe('buildQualifyingMeetBook', () => {
  it('builds a book of the federation rules and the meets read against them', () => {
    const { book } = buildQualifyingMeetBook([document()], STANDARDS);

    expect(book.federations.map((rules) => rules.federationId)).toEqual(['invented']);
    expect(book.meets.map((entry) => entry.id)).toEqual(['invented-championship-2027']);
  });

  it('stamps every meet with the federation the document declares', () => {
    // Derived rather than repeated per meet, so a file cannot claim one
    // federation at the top and another halfway down -- which would resolve every
    // route below the seam against a ladder nobody meant.
    const { book } = buildQualifyingMeetBook(
      [document({ meets: [meet(), meet({ id: 'second-meet' })] })],
      STANDARDS,
    );
    expect(book.meets.map((entry) => entry.federationId)).toEqual(['invented', 'invented']);
  });

  it('builds the federation citation out of the rulebook pin and the day it was read', () => {
    const { book } = buildQualifyingMeetBook([document()], STANDARDS);
    expect(book.federations[0]?.source).toEqual({
      label: 'Invented Federation Rulebook',
      url: 'https://example.test/rulebook',
      revision: '2026v1',
      sections: ['5.1.10 (a)'],
      verifiedOn: '2026-08-05',
    });
  });

  it('reports the transcription as fresh on the day it was read, not the day of the build', () => {
    const { freshness } = buildQualifyingMeetBook([document()], STANDARDS);
    expect(freshness).toEqual([
      {
        id: 'invented-qualification',
        label: 'Invented Federation qualification criteria (Invented Federation Rulebook 2026v1)',
        retrievedAt: '2026-08-05T00:00:00.000Z',
        status: 'ok',
      },
    ]);
  });

  it('sorts the meets rather than leaving them in document order', () => {
    // Artifacts are content-addressed. A document reordered for readability would
    // otherwise rewrite the filename and evict a cache that was still correct.
    const { book } = buildQualifyingMeetBook(
      [document({ meets: [meet({ id: 'zulu' }), meet({ id: 'alpha' })] })],
      STANDARDS,
    );
    expect(book.meets.map((entry) => entry.id)).toEqual(['alpha', 'zulu']);
  });

  it('refuses to build a book from nothing', () => {
    // An empty book leaves the tool's first question with no answers, and draws a
    // form nobody can submit rather than a failure anybody would report.
    expect(() => buildQualifyingMeetBook([], STANDARDS)).toThrow(QualificationSourceError);
  });

  it('refuses a federation with no published classification ladder', () => {
    // Every route names a standard by reference. Without the ladder there is
    // nothing for any of them to resolve against, and the whole document would
    // publish as criteria that can never be met.
    expect(problemsFrom([document()], new Map())).toEqual([
      expect.stringContaining('no classification standards are published'),
    ]);
  });

  it('refuses a route naming a standard the ladder does not carry', () => {
    // The refusal this adapter exists for. An unresolved standard renders as "you
    // have not qualified", which is a real answer nobody investigates, and a typo
    // in one identifier turns every eligible lifter away.
    const problems = problemsFrom([
      document({
        meets: [
          meet({ entry: { kind: 'standard', routes: [route({ standard: badStandard() })] } }),
        ],
      }),
    ]);
    expect(problems).toEqual([
      expect.stringContaining('is not a published classification standard'),
    ]);
  });

  it('does not check a points threshold against the classification ladder', () => {
    // A points requirement names a scoring system, not a grade, so looking it up
    // in the ladder would refuse a perfectly good route.
    const points = {
      kind: 'points',
      systemId: 'invented-points',
      thresholds: [{ sex: 'female', minimumPoints: 400 }],
    };
    expect(
      problemsFrom([
        document({
          meets: [meet({ entry: { kind: 'standard', routes: [route({ standard: points })] } })],
        }),
      ]),
    ).toEqual([]);
  });

  it('refuses a qualifying window that stays open past the first day of the meet', () => {
    // It admits a performance that has not happened at the moment entry is
    // decided, and the tool would count a meet the lifter has not lifted yet.
    const problems = problemsFrom([
      document({
        meets: [
          meet({
            entry: {
              kind: 'standard',
              routes: [route({ window: { from: '2026-01-01', to: '2027-02-01' } })],
            },
          }),
        ],
      }),
    ]);
    expect(problems).toEqual([expect.stringContaining('after the meet begins')]);
  });

  it('accepts a window that closes on the day the meet begins', () => {
    // The boundary is inclusive on purpose: nothing rules out a qualifying meet
    // on the morning of, and refusing it would fail a correct transcription.
    expect(
      problemsFrom([
        document({
          meets: [
            meet({
              entry: {
                kind: 'standard',
                routes: [route({ window: { from: '2026-01-01', to: '2027-01-16' } })],
              },
            }),
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it('refuses a window that stays open into the meet rather than only past the end of it', () => {
    // The boundary is the day the meet *begins*, and this is the case that
    // separates the two: a two-day meet whose window closes on the second day
    // admits a total nobody has lifted while the first day's platform is already
    // running. Measured against the finish instead, the check reads as correct
    // and passes every one-day meet, which is most of them.
    const problems = problemsFrom([
      document({
        meets: [
          meet({
            entry: {
              kind: 'standard',
              routes: [route({ window: { from: '2026-01-01', to: '2027-01-17' } })],
            },
          }),
        ],
      }),
    ]);
    expect(problems).toEqual([expect.stringContaining('after the meet begins')]);
  });

  it('refuses entries recorded as closing after the meet has finished', () => {
    // The tool would tell a lifter there is still time to enter a meet that is
    // over, which is the one wrong answer that cannot be recovered from.
    expect(problemsFrom([document({ meets: [meet({ entryClosesOn: '2027-02-01' })] })])).toEqual([
      expect.stringContaining('after the meet finishes'),
    ]);
  });

  it('accepts entries closing on the last day of the meet itself', () => {
    // Inclusive on purpose, and it is a real transcription rather than a slip:
    // a two-day meet takes the second day's lifters on the morning of. Only a
    // date past the finish is a contradiction, so the check must not tighten to
    // "closes before the meet ends" -- that refuses a correct document, and the
    // build fails on a source that is right.
    expect(problemsFrom([document({ meets: [meet({ entryClosesOn: '2027-01-17' })] })])).toEqual(
      [],
    );
  });

  it('accepts a meet whose announcement prints no closing date', () => {
    expect(problemsFrom([document({ meets: [meet({ entryClosesOn: null })] })])).toEqual([]);
  });

  it('refuses a staged route that does not open until after entries have closed', () => {
    // A staged route is one nobody can take until a date, so a date past the
    // deadline is a route nobody can ever take -- and it renders as an ordinary
    // way in with a date beside it, which is a way in that does not exist.
    const problems = problemsFrom([
      document({
        meets: [
          meet({
            entry: {
              kind: 'standard',
              routes: [route({ availability: { opensOn: '2027-01-10', contingency: null } })],
            },
          }),
        ],
      }),
    ]);
    expect(problems).toEqual([expect.stringContaining('after entries close on 2027-01-02')]);
  });

  it('accepts a staged route that opens on the closing day itself', () => {
    // Inclusive, matching every other boundary in this adapter: a meet may open
    // its last tier on the morning entry closes, and refusing that fails a correct
    // transcription rather than catching a slip.
    expect(
      problemsFrom([
        document({
          meets: [
            meet({
              entry: {
                kind: 'standard',
                routes: [route({ availability: { opensOn: '2027-01-02', contingency: null } })],
              },
            }),
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it('measures a staged route against the end of the meet where no closing day is published', () => {
    // An announcement that did not say when entry closes has still said when the
    // meet ends. Without the fallback there is no bound at all on these meets, so
    // a route opening the month after would publish cleanly -- and it is exactly
    // the meets with the loosest paperwork that get the loosest transcription.
    const staged = (opensOn: string): Record<string, unknown> =>
      document({
        meets: [
          meet({
            entryClosesOn: null,
            entry: {
              kind: 'standard',
              routes: [route({ availability: { opensOn, contingency: null } })],
            },
          }),
        ],
      });

    expect(problemsFrom([staged('2027-02-01')])).toEqual([
      expect.stringContaining('after the meet finishes on 2027-01-17'),
    ]);
    expect(problemsFrom([staged('2027-01-17')])).toEqual([]);
  });

  it('refuses two meets sharing an id', () => {
    // One of them would never be shown, and which one is decided by the order
    // lines happen to appear in the file.
    expect(problemsFrom([document({ meets: [meet(), meet()] })])).toEqual([
      expect.stringContaining('both claim the id'),
    ]);
  });

  it('refuses two documents claiming one federation', () => {
    expect(problemsFrom([document(), document()])).toEqual([
      expect.stringContaining('both claim the federation id'),
    ]);
  });

  it('refuses two federation-wide conditions sharing an id', () => {
    // The same refusal as the meet's, and it needs its own test because the two
    // are separate calls: dropping the federation one leaves every meet check
    // intact, so the suite stays green while a membership deadline disappears
    // from the criteria of every meet the federation sanctions.
    const condition = {
      id: 'membership',
      label: 'Membership',
      detail: 'A current membership is required on the day.',
      quotation: null,
    };
    expect(
      problemsFrom([
        document({
          entryRules: {
            ...(document()['entryRules'] as Record<string, unknown>),
            conditions: [condition, condition],
          },
        }),
      ]),
    ).toEqual([expect.stringContaining('federation "invented": two conditions both use the id')]);
  });

  it('sorts the federations rather than leaving them in directory order', () => {
    // The same reason the meets are sorted, and it needs a second document to be
    // visible at all: with one federation in the book, every ordering agrees.
    const standards: PublishedStandardIds = new Map([
      ['zulu', new Set(['invented-class'])],
      ['alpha', new Set(['invented-class'])],
    ]);
    const { book } = buildQualifyingMeetBook(
      [
        document({ id: 'zulu', meets: [meet({ id: 'zulu-meet' })] }),
        document({ id: 'alpha', meets: [meet({ id: 'alpha-meet' })] }),
      ],
      standards,
    );
    expect(book.federations.map((rules) => rules.federationId)).toEqual(['alpha', 'zulu']);
  });

  it('refuses two routes of one meet sharing an id', () => {
    const problems = problemsFrom([
      document({
        meets: [meet({ entry: { kind: 'standard', routes: [route(), route()] } })],
      }),
    ]);
    expect(problems).toEqual([expect.stringContaining('two qualifying routes both use the id')]);
  });

  it('refuses two conditions of one meet sharing an id', () => {
    // Not a parse failure. It shows up as a list one item short, and the item
    // that goes missing is a membership deadline or a lifter cap -- the half of
    // the criteria no total can satisfy.
    const condition = { id: 'cap', label: 'Cap', detail: 'The meet fills.', quotation: null };
    expect(
      problemsFrom([document({ meets: [meet({ conditions: [condition, condition] })] })]),
    ).toEqual([expect.stringContaining('two conditions both use the id')]);
  });

  it('refuses a route that opens tested entry at a meet with no tested competition', () => {
    const problems = problemsFrom([
      document({
        meets: [
          meet({
            testedOffering: 'untested',
            entry: { kind: 'standard', routes: [route({ appliesToTested: true })] },
          }),
        ],
      }),
    ]);
    expect(problems).toEqual([expect.stringContaining('runs no tested competition')]);
  });

  it('refuses a route that opens untested entry at a tested-only meet', () => {
    const problems = problemsFrom([
      document({
        meets: [
          meet({
            testedOffering: 'tested',
            entry: { kind: 'standard', routes: [route({ appliesToTested: false })] },
          }),
        ],
      }),
    ]);
    expect(problems).toEqual([expect.stringContaining('runs no untested competition')]);
  });

  it('leaves a route that opens either side of a meet running both alone', () => {
    expect(problemsFrom([document()])).toEqual([]);
  });

  it('checks nothing about routes on a meet that states no qualifying total', () => {
    // The `unstated` and `open` variants carry no routes at all, so every route
    // check has to be reachable only through `standard`. A guard written the
    // obvious way would throw here rather than pass.
    const unstated = {
      kind: 'unstated',
      detail: 'The announcement names a cap and a closing date, and no qualifying total.',
    };
    expect(problemsFrom([document({ meets: [meet({ entry: unstated })] })])).toEqual([]);
  });

  it('reports every problem in one throw rather than the first', () => {
    // A transcriber fixing one line at a time round-trips the build once per
    // typo, and an eight-row gear table produces several at once.
    const problems = problemsFrom([
      document({
        meets: [
          meet({
            entryClosesOn: '2027-02-01',
            entry: { kind: 'standard', routes: [route({ standard: badStandard() })] },
          }),
        ],
      }),
    ]);
    expect(problems.length).toBeGreaterThan(1);
  });
});

describe('the gear ladder', () => {
  function withLadder(gearLadder: readonly unknown[]): readonly string[] {
    return problemsFrom([
      document({
        entryRules: { ...(document()['entryRules'] as Record<string, unknown>), gearLadder },
      }),
    ]);
  }

  it('accepts a federation that publishes no ladder at all', () => {
    // Empty is a real answer: it means each category is qualified for on its own.
    expect(withLadder([])).toEqual([]);
  });

  it('refuses a row that does not offer the category the lifter competed in', () => {
    // It silently withdraws an entry the lifter already had by competing there,
    // and the row parses perfectly.
    expect(
      withLadder([
        {
          competedIn: 'Invented Raw',
          standardReachedIn: 'Invented Ply',
          opens: ['Invented Ply'],
        },
      ]),
    ).toEqual([expect.stringContaining('which is the category they already qualified in')]);
  });

  it('refuses a row where reaching a standard does not open that category', () => {
    expect(
      withLadder([
        {
          competedIn: 'Invented Raw',
          standardReachedIn: 'Invented Ply',
          opens: ['Invented Raw'],
        },
      ]),
    ).toEqual([expect.stringContaining('does not open that category')]);
  });

  it('refuses one pair of categories answered twice', () => {
    const row = {
      competedIn: 'Invented Raw',
      standardReachedIn: 'Invented Raw',
      opens: ['Invented Raw'],
    };
    expect(withLadder([row, row])).toEqual([expect.stringContaining('twice')]);
  });

  it('does not run the two halves of a row together when deciding it is a duplicate', () => {
    // The separator, from the only side that can see it. Concatenated plainly,
    // ("Raw", "ClassicPly") and ("RawClassic", "Ply") are one string, so the
    // second row is thrown out as a duplicate of the first -- and the ladder that
    // results is entirely valid, so nothing downstream has anything to notice.
    const first = {
      competedIn: 'Raw',
      standardReachedIn: 'ClassicPly',
      opens: ['Raw', 'ClassicPly'],
    };
    const second = {
      competedIn: 'RawClassic',
      standardReachedIn: 'Ply',
      opens: ['RawClassic', 'Ply'],
    };
    expect(first.competedIn + first.standardReachedIn).toBe(
      second.competedIn + second.standardReachedIn,
    );
    expect(withLadder([first, second])).toEqual([]);
  });

  it('refuses a row naming one opened category twice', () => {
    expect(
      withLadder([
        {
          competedIn: 'Invented Raw',
          standardReachedIn: 'Invented Raw',
          opens: ['Invented Raw', 'Invented Raw'],
        },
      ]),
    ).toEqual([expect.stringContaining('names a category twice')]);
  });
});

/** A standard identifier the invented ladder does not carry. */
function badStandard(): Record<string, unknown> {
  return {
    kind: 'classification',
    standardId: 'invented-elit',
    orAbove: true,
    lift: 'total',
    divisionBasis: 'open',
  };
}
