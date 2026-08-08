// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { AthleteEntry, QualifyingRoute } from '@platform-toolkit/data-contracts';
import { QualifyingMeetBookSchema } from '@platform-toolkit/data-contracts';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import type { ObservedStanding, ResolvedRegistration, RouteReading } from '../types.js';
import {
  findQualifyingMeet,
  meetTiming,
  readMeetCriteria,
  readRoute,
  routeAvailability,
  standardLift,
  type CriteriaContext,
} from './criteria.js';
import { collectStandings } from './history.js';
import {
  classificationRoute,
  entry,
  federationRules,
  meet,
  meetBook,
  pointsRoute,
  TABLES_FIXTURE,
  VOCABULARY_FIXTURE,
  wholeYearWindow,
} from './qualification.fixture.js';

const WINDOW = wholeYearWindow();

const CONTEXT: CriteriaContext = {
  tables: TABLES_FIXTURE,
  vocabulary: VOCABULARY_FIXTURE,
  rules: federationRules(),
};

/** A Masters lifter, tested, 94 kg, Raw -- the registration both total tables cover. */
const MASTER: ResolvedRegistration = {
  sex: 'male',
  equipmentId: 'raw',
  weightClassId: 'to-94',
  divisionId: 'master-1',
  tested: true,
};

const OPEN: ResolvedRegistration = { ...MASTER, divisionId: 'open' };

/** The default performance clause, so a test can patch one field of it. */
const PERFORMANCE = classificationRoute().performance;

function standingFor(...patches: readonly Partial<AthleteEntry>[]): ObservedStanding {
  const [first, ...rest] = collectStandings(
    (patches.length > 0 ? patches : [{}]).map((patch) => entry(patch)),
    WINDOW,
  );
  if (first === undefined || rest.length > 0) {
    throw new Error('Expected these entries to make exactly one standing.');
  }
  return first;
}

function reading(
  route: QualifyingRoute,
  registration: ResolvedRegistration = MASTER,
  ...patches: readonly Partial<AthleteEntry>[]
): RouteReading {
  return readRoute(route, standingFor(...patches), registration, CONTEXT);
}

describe('the fixture book', () => {
  it('is a book the published contract accepts', () => {
    // Not a test of this module. A fixture that drifted out of the schema would let
    // every test below pass against a shape no artifact can hold, which is the one
    // way a green suite here would say nothing about the browser.
    expect(v.safeParse(QualifyingMeetBookSchema, meetBook()).success).toBe(true);
  });
});

describe('a standard a criterion names without saying which table', () => {
  it('collapses to one reading where both tables agree', () => {
    // 595 kg clears First Class in both ladders. The criterion's silence changes
    // nothing a lifter would act on, so the screen is not made to ask about it.
    expect(reading(classificationRoute()).outcome).toMatchObject({
      kind: 'read',
      basis: 'either-table',
    });
  });

  it('shows the less flattering of two readings that agree', () => {
    // Both tables say the total clears First Class, and they disagree about by how
    // much: 49 kg in the Open table, 104 kg in the Masters one. Shown the wider
    // margin, on criteria that never said which table, a lifter would be handed the
    // number easiest to be wrong about.
    expect(reading(classificationRoute()).outcome).toMatchObject({
      kind: 'read',
      reading: { kind: 'reaches', distance: { kilogramsClear: 49 } },
    });
  });

  it('shows the further of two shortfalls, not the nearer', () => {
    // The same rule the other way up, and the direction that matters more. A 500 kg
    // total is 118 kg off Elite in the Open table and 56 kg off it in the Masters
    // one; shown the 56, a lifter who is not close plans a training block around a
    // figure that came out of a table their criteria never named.
    const elite = classificationRoute({
      standard: {
        kind: 'classification',
        standardId: 'elite',
        orAbove: true,
        lift: 'total',
        divisionBasis: null,
      },
    });
    expect(
      reading(elite, MASTER, { squatKg: 170, benchKg: 130, deadliftKg: 200, totalKg: 500 }).outcome,
    ).toMatchObject({
      kind: 'read',
      basis: 'either-table',
      reading: { kind: 'short', distance: { kilogramsShort: 118 } },
    });
  });

  it('shows both readings where they disagree', () => {
    // The case this whole branch exists for. 595 kg is short of Elite in the Open
    // table by 23 kg and clears it in the Masters one by 39 -- so assuming `open`
    // fails a Masters lifter who qualified, and assuming the lifter's own division
    // admits an Open lifter who did not.
    expect(
      reading(
        classificationRoute({
          standard: {
            kind: 'classification',
            standardId: 'elite',
            orAbove: true,
            lift: 'total',
            divisionBasis: null,
          },
        }),
      ).outcome,
    ).toMatchObject({
      kind: 'two-readings',
      open: { kind: 'short', distance: { kilogramsShort: 23 } },
      liftersAgeDivision: { kind: 'reaches', distance: { kilogramsClear: 39 } },
    });
  });

  it('reads only the table the criteria do name', () => {
    expect(
      reading(
        classificationRoute({
          standard: {
            kind: 'classification',
            standardId: 'elite',
            orAbove: true,
            lift: 'total',
            divisionBasis: 'lifters-age-division',
          },
        }),
      ).outcome,
    ).toMatchObject({
      kind: 'read',
      basis: 'lifters-age-division',
      reading: { kind: 'reaches', table: { id: 'total-raw-94-master-tested' } },
    });
  });

  it('reads the Open table for an Open lifter, whichever basis is named', () => {
    // Both bases resolve to the same table here, which is why `either-table` is the
    // common answer rather than an edge case.
    expect(reading(classificationRoute(), OPEN).outcome).toMatchObject({
      kind: 'read',
      basis: 'either-table',
      reading: { table: { id: 'total-raw-94-open-tested' } },
    });
  });

  it('reports a catalogue with no identifiable Open division rather than choosing', () => {
    // Two divisions of equal reach. `openAgeDivision` reports the tie, and this tool
    // has no business breaking it -- picking either would read a lifter's total out
    // of a table nobody nominated.
    expect(
      readRoute(classificationRoute(), standingFor(), MASTER, {
        ...CONTEXT,
        vocabulary: {
          ...VOCABULARY_FIXTURE,
          divisions: [
            { id: 'open-a', label: 'Open A', minimumAge: 14, maximumAge: null },
            { id: 'open-b', label: 'Open B', minimumAge: 14, maximumAge: null },
          ],
        },
      }).outcome,
    ).toMatchObject({
      kind: 'two-readings',
      open: { kind: 'unreadable', reason: 'open-division-unknown' },
      liftersAgeDivision: { kind: 'reaches' },
    });
  });

  it('does not print two different failures as one', () => {
    // Both readings failed, and they failed differently: the Open table is missing
    // from the build, and the Masters one is present and does not carry the rung the
    // criteria named. Folded into a single sentence, one of those is a lie about a
    // table the federation does publish -- and it is the one that decides whether a
    // lifter goes looking at the ladder or at this page.
    expect(
      readRoute(
        classificationRoute({
          standard: {
            kind: 'classification',
            standardId: 'international-elite',
            orAbove: true,
            lift: 'total',
            divisionBasis: null,
          },
        }),
        standingFor(),
        MASTER,
        {
          ...CONTEXT,
          tables: TABLES_FIXTURE.filter((table) => table.id !== 'total-raw-94-open-tested'),
        },
      ).outcome,
    ).toMatchObject({
      kind: 'two-readings',
      open: { kind: 'unreadable', reason: 'no-standards' },
      liftersAgeDivision: { kind: 'unreadable', reason: 'standard-not-published' },
    });
  });

  it('prints one failure once where both readings failed the same way', () => {
    // The contrast. Single-ply matches neither total table, so both readings fail
    // for the same reason and the screen has one sentence to say rather than two.
    expect(
      readRoute(
        classificationRoute(),
        standingFor(),
        { ...MASTER, equipmentId: 'single-ply' },
        CONTEXT,
      ).outcome,
    ).toEqual({
      kind: 'read',
      basis: 'either-table',
      reading: { kind: 'unreadable', reason: 'no-standards' },
    });
  });
});

describe('a standard admitted exactly and not above', () => {
  const bracket = classificationRoute({
    standard: {
      kind: 'classification',
      standardId: 'first',
      orAbove: false,
      lift: 'total',
      divisionBasis: null,
    },
  });

  it('separates a lifter who is over it from one who is on it', () => {
    // `orAbove: false` is rare and it only ever bites upwards: a total that clears
    // the named standard by a rung is *not* in the bracket, and a tool that quietly
    // admitted it would tell a lifter they may enter a meet that will turn them away
    // for being too strong for it.
    expect(reading(bracket).outcome).toMatchObject({
      kind: 'two-readings',
      open: { kind: 'reaches' },
      liftersAgeDivision: { kind: 'above-the-bracket', achieved: { id: 'elite' } },
    });
  });

  it('admits the same total where the criteria said "or above"', () => {
    // The contrast case. Nothing about the lifter changed; one published boolean did.
    expect(reading(classificationRoute()).outcome).toMatchObject({ kind: 'read' });
  });
});

describe("a route read in its own window rather than the screen's", () => {
  const spring = classificationRoute({ window: { from: '2026-05-01', to: '2026-12-31' } });

  it('leaves out a result set before the window opened', () => {
    expect(reading(spring).outcome).toEqual({ kind: 'no-result-in-window', lift: 'total' });
  });

  it('says which result it left out, and why', () => {
    // Listed rather than dropped. A lifter whose best total is six weeks too old
    // needs that sentence; a blank reads as a bug in this page.
    expect(reading(spring).disregarded).toEqual([
      {
        reason: 'outside-the-route-window',
        source: {
          on: '2026-03-14',
          meetName: 'Invented Spring Open',
          federation: 'Invented Federation',
          parentFederation: 'Invented International',
          place: '1',
        },
      },
    ]);
  });

  it('reads the best total inside the window rather than the best overall', () => {
    // The heavier total is outside it. Carrying that one forward is the failure this
    // guards, and it errs upwards.
    const inside = reading(
      spring,
      MASTER,
      { date: '2026-02-02', squatKg: 230, benchKg: 150, deadliftKg: 270, totalKg: 650 },
      { date: '2026-07-07' },
    );
    expect(inside.best?.kilograms).toBe(595);
    expect(inside.best?.source.on).toBe('2026-07-07');
  });
});

describe('which past meets a route counts', () => {
  it('counts a result from a federation the route names', () => {
    expect(reading(classificationRoute()).best?.kilograms).toBe(595);
  });

  it('counts a result whose parent body the route names', () => {
    const byParent = classificationRoute({
      performance: { ...PERFORMANCE, federationNames: ['Invented International'] },
    });
    expect(reading(byParent).best?.kilograms).toBe(595);
  });

  it('forgives punctuation and case, and nothing else', () => {
    // The one place in this package where matching on spelling is right rather than
    // refused: the contract requires these to be spelled the way the archive spells
    // them, so a transcriber wrote the archive's own string on purpose.
    const forgiven = classificationRoute({
      performance: { ...PERFORMANCE, federationNames: ['invented federation!'] },
    });
    expect(reading(forgiven).best?.kilograms).toBe(595);

    const abbreviated = classificationRoute({
      performance: { ...PERFORMANCE, federationNames: ['Invented'] },
    });
    expect(reading(abbreviated).outcome).toEqual({ kind: 'no-result-in-window', lift: 'total' });
    expect(reading(abbreviated).disregarded[0]?.reason).toBe('federation-not-named');
  });

  it('counts every federation where the route restricts none', () => {
    // `null` is "the criteria do not restrict by federation", and it must never
    // become a filter that matches nothing.
    const anywhere = classificationRoute({
      performance: { ...PERFORMANCE, federationNames: null },
    });
    expect(reading(anywhere, MASTER, { federation: 'Some Other Federation' }).best).not.toBeNull();
  });

  it('never matches on territory, which the archive does not record', () => {
    // Carried in order to be said. The archive publishes a meet's federation and not
    // the country it was held in, so a route restricted to one narrows nothing here
    // -- and a screen has to print it rather than have this file pretend.
    const abroad = reading(classificationRoute());
    expect(abroad.route.performance.territory).toBe('Invented Republic');
    expect(abroad.best).not.toBeNull();
  });
});

describe('a route that requires a tested qualifying meet', () => {
  it('counts a meet the archive records as tested', () => {
    expect(reading(classificationRoute()).best?.kilograms).toBe(595);
  });

  it('sets aside a meet the archive records as untested', () => {
    const untested = reading(classificationRoute(), MASTER, { tested: false });
    expect(untested.outcome).toEqual({ kind: 'no-result-in-window', lift: 'total' });
    expect(untested.disregarded[0]?.reason).toBe('meet-not-drug-tested');
  });

  it('says so differently where the archive recorded nothing either way', () => {
    // Two opposite facts, and only one of them is something a lifter can act on: a
    // result that does not count, against a result nobody here can speak for. The
    // second is answered by showing the meet their own paperwork.
    expect(reading(classificationRoute(), MASTER, { tested: null }).disregarded[0]?.reason).toBe(
      'drug-testing-unrecorded',
    );
  });

  it('counts an unrecorded meet where the route asks nothing about testing', () => {
    const silent = classificationRoute({ performance: { ...PERFORMANCE, tested: null } });
    expect(reading(silent, MASTER, { tested: null }).best?.kilograms).toBe(595);
  });
});

describe('a route the meet did not open to this entry', () => {
  const testedOnly = classificationRoute({ appliesToTested: true });

  it('is reported rather than hidden', () => {
    // One meet in the corpus asks a lower standard of its tested entrants than of
    // its non-tested ones, so a lifter deciding which platform to enter has to see
    // the route they are not on.
    expect(reading(testedOnly, { ...MASTER, tested: false }).outcome).toEqual({
      kind: 'not-open-to-this-entry',
      opensTested: true,
    });
  });

  it('does not become applicable through a heavier total', () => {
    const heavier = reading(
      testedOnly,
      { ...MASTER, tested: false },
      { squatKg: 260, benchKg: 170, deadliftKg: 300, totalKg: 730 },
    );
    expect(heavier.outcome.kind).toBe('not-open-to-this-entry');
  });

  it('is read normally for the entry it does open', () => {
    expect(reading(testedOnly).outcome).toMatchObject({ kind: 'read' });
  });
});

describe('a route that asks for a coefficient score', () => {
  it('says it was not computed, and carries what was asked for', () => {
    // A screen that only understood totals would drop this route without saying so,
    // and half of a real meet's criteria with it.
    expect(reading(pointsRoute()).outcome).toMatchObject({
      kind: 'points-not-computed',
      requirement: { systemId: 'invented-coefficient' },
    });
  });

  it('says so even where the window holds no result at all', () => {
    // The other order would blame the window for a limit that is this tool's.
    const outside = pointsRoute({ window: { from: '2020-01-01', to: '2020-12-31' } });
    expect(reading(outside).outcome.kind).toBe('points-not-computed');
  });
});

describe('which lift a standard is read on', () => {
  it('reads a bench standard against the bench table and the best bench', () => {
    // The whole of #89 in one assertion. Every figure here is invented, and they are
    // chosen so the two answers cannot be confused: the lifter's bench is 140 kg and
    // their total is 595, and 595 clears every rung of every table in the fixture. A
    // tool still reading the total would report this route as made, with a margin, on
    // a bench standard the lifter is 17 kg short of.
    const bench = classificationRoute({
      standard: {
        kind: 'classification',
        standardId: 'first',
        orAbove: true,
        lift: 'bench',
        divisionBasis: null,
      },
    });
    const read = reading(bench);
    expect(read.best?.kilograms).toBe(140);
    expect(read.outcome).toMatchObject({
      kind: 'read',
      basis: 'either-table',
      reading: {
        kind: 'short',
        table: { id: 'bench-all' },
        distance: { kilogramsShort: 17 },
      },
    });
  });

  it('names the lift it found no figure of', () => {
    // "No three-lift total in this window" printed under a criterion that asked for a
    // bench sends a lifter looking for the fault in their own history. The window is
    // moved off every result so the outcome is reached at all.
    const bench = classificationRoute({
      standard: {
        kind: 'classification',
        standardId: 'first',
        orAbove: true,
        lift: 'bench',
        divisionBasis: null,
      },
      window: { from: '2020-01-01', to: '2020-12-31' },
    });
    expect(reading(bench).outcome).toEqual({ kind: 'no-result-in-window', lift: 'bench' });
  });

  it('carries the standard rather than reading it on the total where the criteria never said', () => {
    // The direction that costs somebody an entry fee. A three-lift total clears a
    // single-lift standard by construction, so a criterion whose lift is unstated,
    // read on the total, is made every time it is shown -- and the lifter finds out at
    // the weigh-in desk. No figure is taken either: printing this lifter's 595 kg
    // beside the standard is the same assumption one layer further down.
    //
    // Which is also why the outcome is checked ahead of the empty-window one, the way
    // `points-not-computed` is. There is never a figure here, so the later branch would
    // catch every one of these and report a gap in the lifter's history for a gap in
    // the published criteria.
    const unstated = classificationRoute({
      standard: {
        kind: 'classification',
        standardId: 'first',
        orAbove: true,
        lift: null,
        divisionBasis: null,
      },
    });
    const read = reading(unstated);
    expect(read.best).toBeNull();
    expect(read.outcome).toEqual({
      kind: 'lift-not-stated',
      requirement: unstated.standard,
    });
  });

  it('answers the total for a points threshold, which is not a table reading', () => {
    // `standardLift` is what the screen labels its figure from, so it has to answer
    // for both arms of the union. A coefficient is computed from a three-lift total,
    // so the total is the figure a lifter checks the printed threshold against -- but
    // no ladder is read, which is why the outcome is still `points-not-computed`.
    expect(standardLift(pointsRoute().standard)).toBe('total');
    expect(standardLift(classificationRoute().standard)).toBe('total');
  });
});

describe('a standard the published ladder does not carry', () => {
  it('is its own reason, not a total nobody reached', () => {
    // A withheld rung is one no lifter can ever be shown as having met, so a route
    // naming it resolves to nothing. Rendered as "you have not qualified", that is a
    // real answer nobody investigates, and every lifter who could have entered is
    // turned away by a transcription fault.
    expect(
      reading(
        classificationRoute({
          standard: {
            kind: 'classification',
            standardId: 'international-elite',
            orAbove: true,
            lift: 'total',
            divisionBasis: 'lifters-age-division',
          },
        }),
      ).outcome,
    ).toEqual({
      kind: 'read',
      basis: 'lifters-age-division',
      reading: { kind: 'unreadable', reason: 'standard-not-published' },
    });
  });

  it('is distinct from a table two published rules could equally claim', () => {
    // Both squat fixtures re-scoped onto the total, which is the ambiguity case with
    // the totals removed from under it. Ambiguity has to travel all the way out as
    // itself: collapsed into "no standards" it becomes a federation that publishes
    // nothing, and nobody goes and looks at the two rows that disagree.
    const ambiguous = TABLES_FIXTURE.filter((table) => table.id.startsWith('squat-')).map(
      (table) => ({ ...table, scope: { ...table.scope, lift: 'total' as const } }),
    );
    expect(
      readRoute(classificationRoute(), standingFor(), MASTER, { ...CONTEXT, tables: ambiguous })
        .outcome,
    ).toEqual({
      kind: 'read',
      basis: 'either-table',
      reading: { kind: 'unreadable', reason: 'ambiguous-standards' },
    });
  });
});

describe('a total made from fewer than three lifts', () => {
  it('is not read against a route either', () => {
    // The rule lives in `history.ts`, and this proves way one goes through it rather
    // than counting totals of its own. A second implementation would grade a
    // push/pull total against a three-lift standard the first time one was edited.
    const pushPull = reading(classificationRoute(), MASTER, {
      event: 'BD',
      squatKg: null,
      benchKg: 150,
      deadliftKg: 260,
      totalKg: 410,
    });
    expect(pushPull.outcome).toEqual({ kind: 'no-result-in-window', lift: 'total' });
    expect(pushPull.best).toBeNull();
  });
});

describe('a standing whose entries are not all one registration', () => {
  it('reads no total out of it at all', () => {
    // `collectStandings` cannot produce this and a caller can: `readRoute` is
    // exported, and an `ObservedStanding` assembled by hand may carry entries made
    // in two weight classes. Reading the first of them would answer a question about
    // a registration nobody asked about -- and the figure would look right, because
    // it is a total this lifter really made.
    const mixed: ObservedStanding = {
      ...standingFor(),
      entries: [entry(), entry({ weightClassKg: '112', bodyweightKg: 108.2 })],
    };
    expect(readRoute(classificationRoute(), mixed, MASTER, CONTEXT).best).toBeNull();
  });
});

describe('readMeetCriteria', () => {
  const standing = standingFor();

  it('reads every route the meet publishes, in the order it publishes them', () => {
    const result = readMeetCriteria(
      meet({ entry: { kind: 'standard', routes: [classificationRoute(), pointsRoute()] } }),
      standing,
      MASTER,
      CONTEXT,
    );
    expect(
      result.entry.kind === 'routes' ? result.entry.routes.map((one) => one.route.id) : null,
    ).toEqual(['first-class-total', 'invited-by-score']);
  });

  it('keeps a meet that requires no total apart from one nobody transcribed', () => {
    // Opposite facts, and an empty list of routes states them identically. The wrong
    // one rendered tells a lifter they may enter a national championship on the
    // strength of a gap in this repository.
    const open = readMeetCriteria(
      meet({ entry: { kind: 'open', quotation: 'No qualifying total is required.' } }),
      standing,
      MASTER,
      CONTEXT,
    );
    expect(open.entry).toEqual({ kind: 'open', quotation: 'No qualifying total is required.' });

    const unstated = readMeetCriteria(
      meet({ entry: { kind: 'unstated', detail: 'The announcement names no qualifying total.' } }),
      standing,
      MASTER,
      CONTEXT,
    );
    expect(unstated.entry).toEqual({
      kind: 'unstated',
      detail: 'The announcement names no qualifying total.',
    });
  });

  it("puts the conditions no arithmetic can check into the caller's hand", () => {
    // Every one of these has turned somebody away and none of them is a number, so a
    // reading that left them for the caller to remember would look complete and be
    // half an answer. The meet's come first because they are what a lifter opened
    // the announcement for.
    expect(readMeetCriteria(meet(), standing, MASTER, CONTEXT).conditions).toEqual([
      { from: 'meet', condition: expect.objectContaining({ id: 'membership' }) },
      { from: 'federation', condition: expect.objectContaining({ id: 'weigh-in-window' }) },
    ]);
  });

  it('carries the federation entry rules beside the criteria', () => {
    expect(readMeetCriteria(meet(), standing, MASTER, CONTEXT).rules?.weightClass.mayMoveDown).toBe(
      false,
    );
  });

  it('says plainly where the build carries no rules for the federation', () => {
    expect(
      readMeetCriteria(meet(), standing, MASTER, { ...CONTEXT, rules: null }).rules,
    ).toBeNull();
  });

  it('says whether the meet sanctions this entry, without hiding the other one', () => {
    const testedOnly = meet({ testedOffering: 'tested' });
    const untestedLifter = readMeetCriteria(
      testedOnly,
      standing,
      { ...MASTER, tested: false },
      CONTEXT,
    );
    expect(untestedLifter.offersThisEntry).toBe(false);
    expect(untestedLifter.entry.kind).toBe('routes');

    expect(readMeetCriteria(testedOnly, standing, MASTER, CONTEXT).offersThisEntry).toBe(true);
    expect(
      readMeetCriteria(meet(), standing, { ...MASTER, tested: false }, CONTEXT).offersThisEntry,
    ).toBe(true);
  });

  it('rules on nothing', () => {
    // Section 29 puts the verdict with the federation. A field here called anything
    // like `eligible` is how that stops being true, so the shape is asserted whole.
    expect(Object.keys(readMeetCriteria(meet(), standing, MASTER, CONTEXT)).sort()).toEqual([
      'conditions',
      'entry',
      'meet',
      'offersThisEntry',
      'registration',
      'rules',
    ]);
  });
});

describe('findQualifyingMeet', () => {
  it('returns the meet and the rules it is read against', () => {
    const found = findQualifyingMeet(meetBook(), 'invented-national-2026');
    expect(found?.meet.label).toBe('Invented National Championships 2026');
    expect(found?.rules?.federationId).toBe('invented');
  });

  it('returns nothing for a meet the book does not carry', () => {
    // The fourth state the entry union cannot express: a meet nobody has read at all
    // is way three's case, not an empty way one.
    expect(findQualifyingMeet(meetBook(), 'some-other-meet')).toBeNull();
  });

  it('returns the meet with no rules where the book carries none for its federation', () => {
    const book = meetBook({ federations: [federationRules({ federationId: 'elsewhere' })] });
    expect(findQualifyingMeet(book, 'invented-national-2026')?.rules).toBeNull();
  });
});

describe('routeAvailability', () => {
  const staged = (opensOn: string, contingency: string | null = null): QualifyingRoute =>
    classificationRoute({ availability: { opensOn, contingency } });

  it('says nothing about staging for a route that stages nothing', () => {
    // Not folded into `open`. A badge on every ordinary route would make staging
    // look like the normal case, and the reader would start hunting for one on the
    // routes that do not carry it.
    expect(routeAvailability(classificationRoute(), '2027-03-01')).toBe('unstaged');
  });

  it('opens on the published day and not the one after it', () => {
    // "Registration opens up February 1st" admits an entry on February 1st. The
    // exclusive reading shuts the route on the single day the announcement is
    // actually about, which is also the day somebody is refreshing the page.
    expect(routeAvailability(staged('2027-02-01'), '2027-01-31')).toBe('not-yet-open');
    expect(routeAvailability(staged('2027-02-01'), '2027-02-01')).toBe('open');
    expect(routeAvailability(staged('2027-02-01'), '2027-02-02')).toBe('open');
  });

  it('compares dates across a month and a year boundary rather than by digits', () => {
    // The comparison is `YYYY-MM-DD` string ordering, which is date ordering only
    // because every field is zero-padded. A route opening on the 2nd of a month
    // read against the 30th of the one before is where a comparison on day numbers
    // alone would say the route is already open.
    expect(routeAvailability(staged('2027-02-02'), '2027-01-30')).toBe('not-yet-open');
    expect(routeAvailability(staged('2027-01-02'), '2026-12-30')).toBe('not-yet-open');
  });

  it('reports on the date and never on the condition attached to it', () => {
    // The vacancy half is a roster fact and there is no roster here. A route whose
    // date has arrived reads as open even where the meet may have filled, because
    // the alternative is this project inventing the one thing the lifter has to
    // ring the meet about. The sentence is carried for the screen to quote.
    const route = staged('2027-02-01', 'Only if any available slots remain.');
    expect(routeAvailability(route, '2027-03-01')).toBe('open');
    expect(route.availability?.contingency).toContain('slots remain');
  });
});

describe('meetTiming', () => {
  const subject = meet();

  it('is open up to and including the closing day', () => {
    expect(meetTiming(subject, '2027-03-09')).toBe('entry-open');
    expect(meetTiming(subject, '2027-03-10')).toBe('entry-open');
  });

  it('is closed after it', () => {
    expect(meetTiming(subject, '2027-03-11')).toBe('entry-closed');
  });

  it('runs on both days of the meet', () => {
    // Ordered ahead of the closing day on purpose: a meet under way is not a meet
    // whose entry form shut a month ago, though both sentences are true.
    expect(meetTiming(subject, '2027-04-10')).toBe('in-progress');
    expect(meetTiming(subject, '2027-04-11')).toBe('in-progress');
  });

  it('is held once the last day is past', () => {
    expect(meetTiming(subject, '2027-04-12')).toBe('held');
  });

  it('stays open where the announcement named no closing day', () => {
    // A page that did not say is not a page promising the form stays open, and it is
    // not a page saying it has shut either. The reading that leaves a lifter checking
    // is the one that does not turn them away on this project's silence.
    expect(meetTiming(meet({ entryClosesOn: null }), '2027-04-09')).toBe('entry-open');
  });
});
