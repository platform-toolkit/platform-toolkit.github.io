// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import {
  QualifyingEntrySchema,
  QualifyingFederationRulesSchema,
  QualifyingMeetBookSchema,
  QualifyingMeetSchema,
  QualifyingRouteSchema,
  QualifyingStandardSchema,
  QualifyingWindowSchema,
  findQualifyingFederationRules,
  type QualifyingMeetBook,
} from './qualification.js';

/**
 * An invented meet run by an invented federation.
 *
 * Every figure, date and identifier here is made up, for the reason §5.1 gives
 * and with one addition that is specific to this corpus: a fixture holding a real
 * meet's criteria is a second copy of those criteria, and a meet announcement is
 * edited in place. It would keep asserting last season's qualifying window long
 * after the page moved, and it would read as authoritative to whoever found it.
 */
const ROUTE = {
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
    federationNames: ['Invented Federation'],
    tested: true,
    territory: null,
    description: 'From an Invented Federation tested event.',
  },
  window: { from: '2026-01-01', to: '2026-09-30' },
  appliesToTested: true,
  quotation: 'Invented Class total or above is required to qualify, from a tested event.',
  availability: null,
  dispute: null,
};

const MEET = {
  id: 'invented-championship-2027',
  label: 'Invented Federation Championship 2027',
  federationId: 'invented',
  sanctionedBy: 'Invented Federation',
  held: { from: '2027-01-16', to: '2027-01-17' },
  location: 'Invented Hall, Nowhere',
  sanctionNumber: '27-00000',
  offerings: [
    { discipline: 'Full Power', equipment: ['Invented Raw', 'Invented Ply'] },
    { discipline: 'Bench Only', equipment: ['Invented Raw'] },
  ],
  testedOffering: 'both',
  entryClosesOn: '2027-01-02',
  entry: { kind: 'standard', routes: [ROUTE] },
  conditions: [],
  source: {
    label: 'Invented Federation Championship 2027',
    url: 'https://example.test/invented-championship-2027/',
    verifiedOn: '2026-08-05',
  },
};

/**
 * The invented federation's entry rules, invented in the same way and for the
 * same reason: these are a rulebook's sentences, and a fixture holding a real
 * one is a second copy of a document that gets revised.
 */
const FEDERATION_RULES = {
  federationId: 'invented',
  label: 'Invented Federation',
  weightClass: {
    mayMoveUp: true,
    moveUpRequiresHigherStandard: true,
    mayMoveDown: false,
    moveUpRequiresVacancy: true,
    quotation:
      'Lifters may not go down a weight class from the class they qualified for, and may go up one class where they have met that class total and a place is open.',
  },
  gearLadder: [
    { competedIn: 'Invented Raw', standardReachedIn: 'Invented Raw', opens: ['Invented Raw'] },
    {
      competedIn: 'Invented Raw',
      standardReachedIn: 'Invented Ply',
      opens: ['Invented Raw', 'Invented Ply'],
    },
  ],
  testedCrossoverAllowed: false,
  conditions: [],
  source: {
    label: 'Invented Federation Rulebook',
    url: 'https://example.test/rulebook',
    revision: '2026v1',
    sections: ['5.1.10'],
    verifiedOn: '2026-08-05',
  },
};

const BOOK = { federations: [FEDERATION_RULES], meets: [MEET] };

function parsesMeet(candidate: unknown): boolean {
  return v.safeParse(QualifyingMeetSchema, candidate).success;
}

function parsesRules(candidate: unknown): boolean {
  return v.safeParse(QualifyingFederationRulesSchema, candidate).success;
}

describe('QualifyingWindowSchema', () => {
  it('accepts a window that opens and closes on one day', () => {
    // A one-day meet, and a qualifying window that admits a single meet weekend.
    // Both are real and both would be refused by an exclusive end.
    expect(
      v.safeParse(QualifyingWindowSchema, { from: '2026-05-02', to: '2026-05-02' }).success,
    ).toBe(true);
  });

  it('refuses a window that ends before it begins', () => {
    // The transcription mistake this catches is a pair of dates swapped, which
    // otherwise publishes a window no performance can fall inside -- and the
    // screen reads "you have not qualified", which is a real answer nobody
    // investigates.
    expect(
      v.safeParse(QualifyingWindowSchema, { from: '2026-09-30', to: '2026-01-01' }).success,
    ).toBe(false);
  });

  it('refuses an instant where a calendar day belongs', () => {
    // Section 5.5. A window closes on a day in the meet's jurisdiction, and an
    // instant drags a timezone into a comparison that has none.
    expect(
      v.safeParse(QualifyingWindowSchema, { from: '2026-01-01T00:00:00.000Z', to: '2026-09-30' })
        .success,
    ).toBe(false);
  });
});

describe('QualifyingStandardSchema', () => {
  it('reads a classification standard by reference and carries no total', () => {
    const parsed = v.safeParse(QualifyingStandardSchema, ROUTE.standard);
    expect(parsed.success).toBe(true);
    // Stated as an assertion rather than left to the reader of the schema: the
    // totals live in the classification ladder, and a figure appearing here would
    // be a second copy to keep in step.
    expect(Object.keys(ROUTE.standard)).not.toContain('requiredKilograms');
  });

  it('accepts a points threshold per sex', () => {
    expect(
      v.safeParse(QualifyingStandardSchema, {
        kind: 'points',
        systemId: 'invented-points',
        thresholds: [
          { sex: 'female', minimumPoints: 400 },
          { sex: 'male', minimumPoints: 425 },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuses two thresholds for one sex', () => {
    // Two figures for one lifter is a criterion with no answer, and the one the
    // tool happened to read first would decide whether somebody may enter.
    expect(
      v.safeParse(QualifyingStandardSchema, {
        kind: 'points',
        systemId: 'invented-points',
        thresholds: [
          { sex: 'female', minimumPoints: 400 },
          { sex: 'female', minimumPoints: 425 },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuses a threshold of zero', () => {
    // Zero is not a low bar, it is the absence of one, and it would admit every
    // lifter to an invite-only meet.
    expect(
      v.safeParse(QualifyingStandardSchema, {
        kind: 'points',
        systemId: 'invented-points',
        thresholds: [{ sex: 'male', minimumPoints: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe('QualifyingEntrySchema', () => {
  it('states an open meet as an open meet and not as an absence', () => {
    // The distinction the union exists for. An empty route list would say this
    // and "nobody has transcribed this meet" in the same bytes, and the wrong one
    // of those tells a lifter they may enter a national championship on the
    // strength of a gap in this repository.
    expect(
      v.safeParse(QualifyingEntrySchema, {
        kind: 'open',
        quotation: 'Open to all members. No qualifying total is required.',
      }).success,
    ).toBe(true);
  });

  it('separates a page that says no total is needed from a page that never mentions one', () => {
    // The three-state distinction, asserted as a distinction rather than as two
    // parses that happen to succeed. Collapsed to one variant, an announcement
    // that simply omits the subject would render as the federation granting open
    // entry -- a permission this project would have authored.
    const said = { kind: 'open', quotation: 'No qualifying total is required for this meet.' };
    const silent = {
      kind: 'unstated',
      detail: 'The announcement lists categories, a lifter cap and a closing date, and no total.',
    };
    expect(v.safeParse(QualifyingEntrySchema, said).success).toBe(true);
    expect(v.safeParse(QualifyingEntrySchema, silent).success).toBe(true);
    expect(v.parse(QualifyingEntrySchema, said).kind).not.toBe(
      v.parse(QualifyingEntrySchema, silent).kind,
    );
  });

  it('refuses a qualifying entry with no route in it', () => {
    expect(v.safeParse(QualifyingEntrySchema, { kind: 'standard', routes: [] }).success).toBe(
      false,
    );
  });

  it('refuses an open entry that does not quote the page saying so', () => {
    // "No total is required" is the one claim in this contract that cannot be
    // checked against anything downstream, so the document has to be made to say
    // it out loud.
    expect(v.safeParse(QualifyingEntrySchema, { kind: 'open' }).success).toBe(false);
  });

  it('refuses an unstated entry that does not say what the page says instead', () => {
    // A bare marker is reachable by giving up on a page, and giving up is the one
    // state this variant must never be confused with.
    expect(v.safeParse(QualifyingEntrySchema, { kind: 'unstated' }).success).toBe(false);
  });
});

describe('QualifyingRouteSchema availability', () => {
  const staged = (availability: unknown): unknown => ({ ...ROUTE, availability });

  it('takes a route the meet does not open until a published day', () => {
    expect(
      v.safeParse(QualifyingRouteSchema, staged({ opensOn: '2026-11-01', contingency: null }))
        .success,
    ).toBe(true);
  });

  it('carries a condition on the date that it does not try to settle', () => {
    // The half of a staged route this project has no way to answer: a vacancy is a
    // roster fact and there is no roster here. Carried as a sentence so a screen
    // can quote it, which is the same treatment the planner gives a deadline it
    // cannot observe.
    const parsed = v.parse(
      QualifyingRouteSchema,
      staged({
        opensOn: '2026-11-01',
        contingency: 'Only if any available slots remain after the earlier tier.',
      }),
    );
    expect(parsed.availability?.contingency).toContain('slots remain');
  });

  it('distinguishes a route that stages nothing from one that opened yesterday', () => {
    // The reason `availability` is nullable rather than defaulted to a past date.
    // Flattened, a screen could no longer say that a staged route is still shut,
    // which is the one fact a lifter reading a staged announcement is after.
    expect(v.parse(QualifyingRouteSchema, staged(null)).availability).toBeNull();
    expect(
      v.parse(QualifyingRouteSchema, staged({ opensOn: '2026-01-01', contingency: null }))
        .availability,
    ).not.toBeNull();
  });

  it('refuses an opening day that is not a calendar day', () => {
    // A month is what an announcement usually says -- "registration opens in
    // February" -- and it is not something a comparison can be made against. The
    // transcriber has to find the day or leave the route unstaged.
    expect(
      v.safeParse(QualifyingRouteSchema, staged({ opensOn: '2026-02', contingency: null })).success,
    ).toBe(false);
  });

  it('refuses a route with no availability key at all', () => {
    // Nullable and not optional, deliberately. A transcriber who forgets the field
    // publishes a route that reads as staging nothing, and a staged route silently
    // becoming an open one is the over-reporting this whole field exists to stop.
    const { availability: _unused, ...withoutIt } = ROUTE;
    expect(v.safeParse(QualifyingRouteSchema, withoutIt).success).toBe(false);
  });
});

describe('QualifyingMeetSchema', () => {
  it('accepts a meet with a route, a dispute-free reading and no conditions', () => {
    expect(parsesMeet(MEET)).toBe(true);
  });

  it('keeps a dispute on the route it makes uncertain', () => {
    // Carried on the route rather than beside it, so that nothing can render the
    // route without the dispute in hand.
    const disputed = {
      ...MEET,
      entry: {
        kind: 'standard',
        routes: [
          {
            ...ROUTE,
            dispute: {
              summary: 'The announcement names two different standards for this entry.',
              readings: [
                { where: 'Event details', quotation: 'An Invented Class total is required.' },
                { where: 'Do I qualify?', quotation: 'An Invented Elite total is required.' },
              ],
            },
          },
        ],
      },
    };
    expect(parsesMeet(disputed)).toBe(true);
  });

  it('refuses a dispute with only one reading in it', () => {
    // One reading is not a dispute, it is the encoded standard -- and a screen
    // warning of a conflict it cannot show both sides of is worse than no
    // warning, because a lifter cannot act on it.
    const single = {
      ...MEET,
      entry: {
        kind: 'standard',
        routes: [
          {
            ...ROUTE,
            dispute: {
              summary: 'The announcement names two different standards for this entry.',
              readings: [{ where: 'Event details', quotation: 'An Invented Class total.' }],
            },
          },
        ],
      },
    };
    expect(parsesMeet(single)).toBe(false);
  });

  it.each([
    ['nothing contested', { offerings: [] }],
    [
      'a discipline contested in no gear category',
      { offerings: [{ discipline: 'Full Power', equipment: [] }] },
    ],
    ['a federation with no identifier', { federationId: '' }],
    ['no sanctioning body named', { sanctionedBy: '' }],
    ['a tested offering the contract does not know', { testedOffering: 'sometimes' }],
    [
      'criteria that are neither open, unstated nor a set of routes',
      { entry: { kind: 'unknown' } },
    ],
  ])('refuses a meet with %s', (_description, overrides) => {
    expect(parsesMeet({ ...MEET, ...overrides })).toBe(false);
  });

  it('keeps each discipline with the gear it is actually contested in', () => {
    // Two flat lists would take a meet running full power raw and bench only
    // multi-ply and publish an equipped full power competition nobody announced.
    // The pairing is what stops the tool inventing an offering.
    const parsed = v.parse(QualifyingMeetSchema, MEET);
    expect(parsed.offerings.map((offering) => offering.equipment.length)).toEqual([2, 1]);
  });

  it('refuses a meet that lists one discipline twice', () => {
    // Two answers to "what gear can I lift this in", and the tool would show
    // whichever row it reached first.
    expect(
      parsesMeet({
        ...MEET,
        offerings: [
          { discipline: 'Full Power', equipment: ['Invented Raw'] },
          { discipline: 'Full Power', equipment: ['Invented Ply'] },
        ],
      }),
    ).toBe(false);
  });

  it('accepts a meet whose announcement prints no closing date', () => {
    // Plenty print only a lifter cap and fill instead, so this has to be a
    // statable absence rather than a date somebody picks to fill the field.
    expect(parsesMeet({ ...MEET, entryClosesOn: null })).toBe(true);
  });

  it('keeps the sanctioning body separate from the federation the data comes from', () => {
    // The pair that forced the two fields apart: an international championship
    // announced by its national affiliate, whose members qualify against the
    // affiliate's ladder. One field would have to lie about one of them, and the
    // one it would lie about is which membership card is wanted at the door.
    const affiliated = {
      ...MEET,
      sanctionedBy: 'Invented International League',
    };
    expect(parsesMeet(affiliated)).toBe(true);
    expect(affiliated.federationId).not.toBe(affiliated.sanctionedBy);
  });

  it('accepts a sanction number stated as absent', () => {
    // Roughly half the announcements read for this contract print no sanction
    // number. Requiring one would have meant inventing them, and an invented
    // sanction number is a string a lifter would quote to a federation.
    expect(parsesMeet({ ...MEET, sanctionNumber: null })).toBe(true);
  });

  it('refuses a meet that leaves the sanction number out altogether', () => {
    // Nullable and not optional, so that "this page prints no sanction number"
    // is a thing a transcriber wrote down rather than a key they forgot.
    const { sanctionNumber: _unused, ...withoutNumber } = MEET;
    expect(parsesMeet(withoutNumber)).toBe(false);
  });

  it('refuses a citation that is not https', () => {
    // `v.url()` alone accepts `javascript:`, which validates, renders, and
    // executes when somebody taps the link under a meet's criteria.
    expect(
      parsesMeet({
        ...MEET,
        source: { ...MEET.source, url: 'javascript:alert(1)' },
      }),
    ).toBe(false);
  });

  it('refuses a meet with no day a person read it', () => {
    // A meet announcement carries no revision and is edited in place, so this
    // date is the only thing standing between a screen and a criterion that
    // changed last Tuesday.
    const { verifiedOn: _unused, ...source } = MEET.source;
    expect(parsesMeet({ ...MEET, source })).toBe(false);
  });
});

describe('QualifyingFederationRulesSchema', () => {
  it('accepts a federation whose rules were read out of a pinned rulebook', () => {
    expect(parsesRules(FEDERATION_RULES)).toBe(true);
  });

  it('keeps both directions of the weight-class rule apart', () => {
    // The asymmetry is the rule. A single flag would have to pick one direction
    // to be true about, and the direction it got wrong would either offer a
    // lifter a class they may not enter or withhold one they may.
    const rule = FEDERATION_RULES.weightClass;
    expect(rule.mayMoveUp).not.toBe(rule.mayMoveDown);
    expect(
      parsesRules({
        ...FEDERATION_RULES,
        weightClass: { ...rule, mayMoveDown: true },
      }),
    ).toBe(true);
  });

  // `as const` rather than plain strings, so each key is a literal the object
  // actually has. Widened to `string` the destructuring below is an index-signature
  // read, which is TS2537 -- and the obvious way out of that error is a cast that
  // would keep this suite passing after somebody renamed one of the four fields.
  it.each([
    ['may move up', 'mayMoveUp'],
    ['also needs the heavier class total', 'moveUpRequiresHigherStandard'],
    ['may move down', 'mayMoveDown'],
    ['needs room on the roster', 'moveUpRequiresVacancy'],
  ] as const)(
    'refuses a weight-class rule that does not say whether a lifter %s',
    (_description, field) => {
      // Every one of these is a boolean and not a nullable, so an omission cannot
      // arrive as a soft "unknown" that renders as a permission. A transcriber who
      // cannot answer one of them has not finished reading the section.
      const { [field]: _unused, ...partial } = FEDERATION_RULES.weightClass;
      expect(parsesRules({ ...FEDERATION_RULES, weightClass: partial })).toBe(false);
    },
  );

  it('accepts a federation that publishes no gear ladder', () => {
    // Distinguishable from a federation nobody has transcribed, which is absent
    // from the book entirely. Empty means each category is qualified for on its
    // own, which is a real and common rule.
    expect(parsesRules({ ...FEDERATION_RULES, gearLadder: [] })).toBe(true);
  });

  it('refuses a gear ladder row that opens nothing', () => {
    // A row saying a total opens no category at all is a row that removes an
    // entry the lifter already had by competing in that category.
    expect(
      parsesRules({
        ...FEDERATION_RULES,
        gearLadder: [{ competedIn: 'Invented Raw', standardReachedIn: 'Invented Raw', opens: [] }],
      }),
    ).toBe(false);
  });

  it('refuses a rulebook citation with no revision on it', () => {
    // The one field separating a rulebook citation from a meet announcement's.
    // Without it there is nothing for `check:upstream` to pin, and the rules
    // silently become whatever edition was current when somebody last looked.
    const { revision: _unused, ...source } = FEDERATION_RULES.source;
    expect(parsesRules({ ...FEDERATION_RULES, source })).toBe(false);
  });

  it('refuses a rulebook citation naming no section', () => {
    // These rules are four sentences out of a hundred-page document. A citation
    // that cannot be followed to a paragraph is not a citation.
    expect(
      parsesRules({ ...FEDERATION_RULES, source: { ...FEDERATION_RULES.source, sections: [] } }),
    ).toBe(false);
  });

  it('accepts a federation whose rules do not say whether tested crosses over', () => {
    // Section 5.5. Silence in a rulebook is not a permission and is not a
    // refusal, and the screen has to be able to say which one it is holding.
    expect(parsesRules({ ...FEDERATION_RULES, testedCrossoverAllowed: null })).toBe(true);
  });
});

describe('QualifyingMeetBookSchema', () => {
  it('refuses a book with no meets in it', () => {
    // An empty book publishes a working artifact that says nothing, and the
    // screen reads "no meets have been ingested" -- which is true, and is a state
    // the absence of the artifact already expresses more honestly.
    expect(v.safeParse(QualifyingMeetBookSchema, { ...BOOK, meets: [] }).success).toBe(false);
  });

  it('refuses a book of meets with no federation rules behind them', () => {
    // The weight-class and gear rules decide whether a lifter's total lets them
    // enter at all, so a book without them draws a fraction of the criteria
    // while looking complete.
    expect(v.safeParse(QualifyingMeetBookSchema, { federations: [], meets: [MEET] }).success).toBe(
      false,
    );
  });

  it('accepts a book of one meet and the rules it is read against', () => {
    expect(v.safeParse(QualifyingMeetBookSchema, BOOK).success).toBe(true);
  });
});

describe('findQualifyingFederationRules', () => {
  const book = v.parse(QualifyingMeetBookSchema, BOOK) satisfies QualifyingMeetBook;

  it('finds the rules a meet is read against', () => {
    expect(findQualifyingFederationRules(book, MEET.federationId)?.label).toBe(
      FEDERATION_RULES.label,
    );
  });

  it('answers null for a federation the book does not carry', () => {
    // Publication refuses a meet whose federation is missing, so this is a
    // browser holding an older artifact. Returning the first federation instead
    // would show one federation's entry rules under another's championship.
    expect(findQualifyingFederationRules(book, 'not-in-this-book')).toBeNull();
  });

  it('does not resolve an inherited property as a federation', () => {
    // The book comes out of `JSON.parse` and the identifier comes off a page
    // attribute. A lookup written as an object index would answer `constructor`
    // with a function, which is not rules and is also not `null`.
    expect(findQualifyingFederationRules(book, 'constructor')).toBeNull();
  });
});
