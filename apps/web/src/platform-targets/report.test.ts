import type {
  CategoryCatalog,
  ClassificationBook,
  Lift,
  RecordBook,
} from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  buildReport,
  nextIn,
  reachedIn,
  type Report,
  type ReportCell,
  type ReportRow,
} from './report.js';
import {
  ANSWERED,
  BOOK,
  CATALOG,
  CLASSIFICATIONS,
  FULLY_ANSWERED,
  NATIONAL,
  NORTH,
  STATE_BOOK,
  bookOf,
  classificationTable as table,
  record,
} from './records-fixture.js';
import {
  partitionKey,
  resolveSelection,
  type CategorySelection,
  type RecordPartition,
} from './selection.js';
import { lifterAxesFrom } from './standards.js';

function booksOf(
  entries: readonly (readonly [RecordPartition, RecordBook | null])[],
): ReadonlyMap<string, RecordBook | null> {
  return new Map(entries.map(([partition, book]) => [partitionKey(partition), book]));
}

interface ReportOptions {
  readonly catalog?: CategoryCatalog;
  readonly classifications?: ClassificationBook | null;
  readonly books?: readonly (readonly [RecordPartition, RecordBook | null])[];
}

/**
 * A report assembled the way the element assembles one.
 *
 * Through `resolveSelection` and `lifterAxesFrom` rather than from a literal,
 * for the reason the record tests give: a hand-written `ResolvedSelection` is
 * free to list a division the catalogue does not publish or a partition the
 * region answer does not settle, and those disagreements are exactly what this
 * file exists to catch.
 */
function reportFor(selection: CategorySelection, options: ReportOptions = {}): Report {
  const catalog = options.catalog ?? CATALOG;
  const resolved = resolveSelection(catalog, selection);
  return buildReport({
    resolved,
    axes: lifterAxesFrom(resolved.selection),
    classifications:
      options.classifications === undefined ? CLASSIFICATIONS : options.classifications,
    recordBooks: booksOf(options.books ?? [[NATIONAL, BOOK]]),
  });
}

function cellFor(report: Report, lift: Lift, weightClassId = 'f-56'): ReportCell {
  const section = report.sections.find((candidate) => candidate.lift === lift);
  const cell = section?.cells.find((candidate) => candidate.weightClass.id === weightClassId);
  if (cell === undefined) {
    throw new Error(`No ${lift} cell for "${weightClassId}".`);
  }
  return cell;
}

function titlesIn(cell: ReportCell): string[] {
  return cell.rows.map((row) => row.title);
}

function weightsIn(cell: ReportCell): number[] {
  return cell.rows.map((row) => row.kilograms);
}

function everyRow(report: Report): ReportRow[] {
  return report.sections.flatMap((section) => section.cells.flatMap((cell) => cell.rows));
}

describe('buildReport', () => {
  it('has a section per contested lift even before anything is answered', () => {
    // The panel draws headings from this, and a report that returned nothing at
    // all would make the whole screen appear after the last read instead of
    // filling in -- which on gym signal is most of a minute of blank page.
    const report = reportFor({
      sex: null,
      equipment: null,
      weightClass: null,
      comparisonWeightClass: null,
      division: null,
      tested: null,
      region: null,
    });
    expect(report.sections.map((section) => section.label)).toEqual([
      'Squat',
      'Bench press',
      'Deadlift',
      'Total',
    ]);
    expect(report.weightClasses).toEqual([]);
    expect(everyRow(report)).toEqual([]);
  });

  /**
   * Requirement 9's other half, and the reason the report is worth building: the
   * optional answers add columns, so a report drawn from the four required ones
   * is complete rather than provisional.
   */
  it('is a whole report from the required answers alone', () => {
    const report = reportFor(ANSWERED);
    expect(report.weightClasses.map((weightClass) => weightClass.id)).toEqual(['f-56']);
    expect(everyRow(report).length).toBeGreaterThan(0);
  });

  /**
   * Requirement 7. All of them, not the next one -- a lifter deciding what to
   * open with wants the whole ladder in front of them, and the old panel's
   * "next classification" sentence was one rung of it.
   */
  it('shows every classification level the federation publishes', () => {
    expect(titlesIn(cellFor(reportFor(ANSWERED), 'deadlift'))).toEqual([
      'Class III',
      'Class II',
      'Class I',
    ]);
  });

  /**
   * The central claim. A classification and a record are one ladder, sorted by
   * weight, so a lifter reads down a cell in the order they would actually meet
   * the rungs -- rather than reading two panels and doing the interleaving in
   * their head.
   */
  it('merges records into the classification ladder in weight order', () => {
    const cell = cellFor(reportFor(ANSWERED), 'squat');
    expect(weightsIn(cell)).toEqual([100, 120, 145.5, 150]);
    expect(titlesIn(cell)).toEqual(['Class III', 'Class II', 'National record', 'Class I']);
  });

  /**
   * The rung is the weight that *takes* the record, never the record itself.
   * Sorting on the record would place it in the ladder at a weight that does not
   * claim it, so a lifter reading the order would open half a kilo light.
   */
  it('places a record at the weight that takes it, and still says what stands', () => {
    const row = cellFor(reportFor(ANSWERED), 'squat').rows.find(
      (candidate) => candidate.title === 'National record',
    );
    expect(row?.kilograms).toBe(145.5);
    expect(row?.kind === 'record' ? row.detail.record.kilograms : null).toBe(145);
  });

  /**
   * Requirement 5. Both units on every rung, converted with the exact factor --
   * not the federation's own truncated one, which exists to reproduce a
   * classification calculator and would put its arithmetic on another
   * federation's records.
   */
  it('writes every weight in kilograms and in pounds', () => {
    const [first] = cellFor(reportFor(ANSWERED), 'squat').rows;
    expect(first?.kilogramsText).toBe('100');
    expect(first?.poundsText).toBe('220.5');
    const record145 = cellFor(reportFor(ANSWERED), 'squat').rows[2];
    expect(record145?.kilogramsText).toBe('145.5');
    expect(record145?.poundsText).toBe('320.8');
  });

  /**
   * Requirement 4. The old panel asked which event and showed one; a lifter
   * planning a meet wants the ones they might enter as well as the one they are
   * entered in.
   */
  it('covers every event the federation contests, without asking which', () => {
    const benchBook = bookOf([
      record('bench', { kilograms: 82.5 }),
      record('bench', { kilograms: 84, disciplineId: 'bench-only' }),
      record('bench', { kilograms: 83, disciplineId: 'push-pull' }),
    ]);
    const cell = cellFor(reportFor(ANSWERED, { books: [[NATIONAL, benchBook]] }), 'bench');
    const events = cell.rows.map((row) => row.eventLabel).filter((label) => label !== null);
    expect([...events].sort()).toEqual(['Bench only', 'Full power', 'Push pull']);
  });

  /**
   * ...but only the lifts each event actually contests. A bench-only meet has no
   * squat record, and a row saying none stands would be true of a record that
   * cannot exist -- which reads as a hole in the published data.
   */
  it('never invents a lift an event does not contest', () => {
    const cell = cellFor(reportFor(ANSWERED), 'squat');
    const events = cell.rows.map((row) => row.eventLabel).filter((label) => label !== null);
    expect(events).toEqual(['Full power']);
  });

  /**
   * Requirement 3. World and national records are always shown; a state is
   * optional and adds to them rather than replacing them. This catalogue's
   * national level is not subdivided and its state level is, so answering the
   * region is exactly what turns one partition into two.
   */
  it('shows the unsubdivided levels with no region answered', () => {
    const cell = cellFor(reportFor(ANSWERED), 'squat');
    expect(titlesIn(cell)).toContain('National record');
    expect(titlesIn(cell)).not.toContain('North Example State record');
  });

  it('adds the state records to them once a state is answered', () => {
    const report = reportFor(FULLY_ANSWERED, {
      books: [
        [NORTH, STATE_BOOK],
        [NATIONAL, BOOK],
      ],
    });
    const cell = cellFor(report, 'squat');
    expect(titlesIn(cell)).toEqual([
      'Class III',
      'Class II',
      'North Example State record',
      'National record',
      'Class I',
    ]);
    expect(weightsIn(cell)).toEqual([100, 120, 130.5, 145.5, 150]);
  });

  /**
   * Requirement 8. Two columns, aligned across every section, so a lifter
   * deciding whether to cut can read the two ladders side by side.
   */
  it('draws a column per weight class, in ladder order', () => {
    const report = reportFor(FULLY_ANSWERED);
    expect(report.weightClasses.map((weightClass) => weightClass.id)).toEqual(['f-52', 'f-56']);
    for (const section of report.sections) {
      expect(section.cells.map((cell) => cell.weightClass.id)).toEqual(['f-52', 'f-56']);
    }
  });

  it('keeps a record out of the class it was not set in', () => {
    // The fixture's records are all f-56. An f-52 column carrying them would be
    // the worst available failure on a screen whose whole job is matching a
    // category exactly.
    const report = reportFor(FULLY_ANSWERED);
    expect(titlesIn(cellFor(report, 'squat', 'f-52'))).toEqual([
      'Class III',
      'Class II',
      'Class I',
    ]);
  });

  /**
   * Requirement 2. Open is always drawn and the chosen band is drawn beside it,
   * which is what makes the age question optional rather than load-bearing.
   */
  it('covers Open as well as the chosen division', () => {
    const openSquat = record('squat', { kilograms: 145 });
    const masters = bookOf([
      openSquat,
      {
        ...openSquat,
        id: 'national-none-full-power-squat-masters-1',
        scope: { ...openSquat.scope, divisionId: 'masters-1' },
        kilograms: 118,
      },
    ]);
    const report = reportFor(FULLY_ANSWERED, { books: [[NATIONAL, masters]] });
    const divisions = cellFor(report, 'squat')
      .rows.filter((row) => row.kind === 'record')
      .map((row) => row.divisionLabel);
    expect([...divisions].sort()).toEqual(['Masters 1', 'Open']);
  });

  /**
   * A federation publishing one table for everybody produces the identical
   * ladder under Open and under Masters 1. Printing it twice with two labels
   * reads as two different standards a lifter has to tell apart, so the rows
   * collapse and the label goes away.
   */
  it('collapses one table serving every division into one unlabelled ladder', () => {
    const cell = cellFor(reportFor(FULLY_ANSWERED), 'deadlift');
    expect(titlesIn(cell)).toEqual(['Class III', 'Class II', 'Class I']);
    expect(cell.rows.map((row) => row.divisionLabel)).toEqual([null, null, null]);
  });

  it('names the divisions a table serves when it does not serve them all', () => {
    const perDivision: ClassificationBook = {
      ...CLASSIFICATIONS,
      tables: [
        table('squat', { divisionId: 'open' }),
        table('squat', { divisionId: 'masters-1' }, [
          { id: 'third', label: 'Class III', rank: 0, requiredKilograms: 90 },
        ]),
      ],
    };
    const cell = cellFor(reportFor(FULLY_ANSWERED, { classifications: perDivision }), 'squat');
    const labelled = cell.rows.filter((row) => row.kilograms === 90);
    expect(labelled.map((row) => row.divisionLabel)).toEqual(['Masters 1']);
  });

  /**
   * Requirement 12's data half, carried through to the row the panel links from.
   * Assembled URLs are refused a layer down; this only checks the book's own
   * table reaches the row.
   */
  it('carries the federation’s own table link onto the record row', () => {
    const row = cellFor(reportFor(ANSWERED), 'squat').rows.find(
      (candidate) => candidate.kind === 'record',
    );
    expect(row?.kind === 'record' ? row.detail.sourceUrl : null).toBe(
      'https://records.example.test/records?level=national&event=raw-full-power',
    );
  });

  it('carries no link for a scope the book lists no table for', () => {
    const report = reportFor(FULLY_ANSWERED, { books: [[NORTH, STATE_BOOK]] });
    const row = cellFor(report, 'squat').rows.find((candidate) => candidate.kind === 'record');
    expect(row?.kind === 'record' ? row.detail.sourceUrl : 'missing').toBeNull();
  });

  /**
   * Requirement 6 arriving in the row. Both conditions, because the rule turns
   * on the level of the meet entered and this application cannot see which meet
   * that is -- naming one figure with no condition is the wrong number at every
   * meet held above the record's own level.
   */
  it('gives each record both of the weights that could take it', () => {
    const row = cellFor(reportFor(ANSWERED), 'squat').rows.find(
      (candidate) => candidate.kind === 'record',
    );
    const targets = row?.kind === 'record' ? row.detail.targets : [];
    expect(targets.map((target) => [target.condition, target.kilograms])).toEqual([
      ['At a meet of this level or below', 145.5],
      ['At a meet above this level', 147.5],
    ]);
  });

  it('reports who holds a record, in the date the federation published', () => {
    const row = cellFor(reportFor(ANSWERED), 'squat').rows.find(
      (candidate) => candidate.kind === 'record',
    );
    expect(row?.kind === 'record' ? row.detail.holder : null).toEqual({
      name: 'Robin Vance',
      achievedOn: '2024-05-18',
      meetName: 'Example Winter Open',
    });
    expect(row?.kind === 'record' ? row.detail.unclaimed : null).toBe(false);
  });

  /**
   * A seeded record is a record with an invitation attached, not a gap in the
   * data. The two want opposite sentences, so they are separate fields rather
   * than an absent holder standing in for both.
   */
  it('distinguishes a record nobody holds from one whose holder was not published', () => {
    const seeded = bookOf([record('squat', { kilograms: 145, unclaimed: true })]);
    const row = cellFor(reportFor(ANSWERED, { books: [[NATIONAL, seeded]] }), 'squat').rows.find(
      (candidate) => candidate.kind === 'record',
    );
    expect(row?.kind === 'record' ? row.detail.unclaimed : null).toBe(true);
    expect(row?.kind === 'record' ? row.detail.holder : 'missing').toBeNull();

    const anonymous = bookOf([
      record('squat', { kilograms: 145, holderName: null, achievedOn: null, meetName: null }),
    ]);
    const other = cellFor(
      reportFor(ANSWERED, { books: [[NATIONAL, anonymous]] }),
      'squat',
    ).rows.find((candidate) => candidate.kind === 'record');
    expect(other?.kind === 'record' ? other.detail.unclaimed : null).toBe(false);
    expect(other?.kind === 'record' ? other.detail.holder : 'missing').toBeNull();
  });

  /**
   * The reason the input takes a map rather than a list: the reads settle
   * independently, and a report that waited for the last one would be blank for
   * the whole time a phone on gym signal is doing the work.
   */
  it('draws the partitions that have arrived and leaves room for the rest', () => {
    const report = reportFor(FULLY_ANSWERED, { books: [[NATIONAL, BOOK]] });
    expect(titlesIn(cellFor(report, 'squat'))).toContain('National record');
    expect(titlesIn(cellFor(report, 'squat'))).not.toContain('North Example State record');
  });

  it('treats a partition published with no book the same as one not yet read', () => {
    const report = reportFor(FULLY_ANSWERED, {
      books: [
        [NORTH, null],
        [NATIONAL, BOOK],
      ],
    });
    expect(titlesIn(cellFor(report, 'squat'))).not.toContain('North Example State record');
  });

  it('still draws the record ladder when no classifications are published', () => {
    const cell = cellFor(reportFor(ANSWERED, { classifications: null }), 'squat');
    expect(titlesIn(cell)).toEqual(['National record']);
  });

  /**
   * Reported, never resolved by document order (§5.5). Both of these produce a
   * plausible figure that is wrong half the time, with nothing on screen to
   * indicate which half.
   */
  it('refuses to choose between two sets of standards, and says so under the lift', () => {
    const conflicting: ClassificationBook = {
      ...CLASSIFICATIONS,
      tables: [table('squat', { divisionId: 'open' }), table('squat', { tested: true })],
    };
    const cell = cellFor(reportFor(ANSWERED, { classifications: conflicting }), 'squat');
    expect(cell.notices).toEqual([
      'More than one set of standards applies to Open, so none can be shown.',
    ]);
    expect(titlesIn(cell)).toEqual(['National record']);
  });

  it('refuses to choose between two records for one category', () => {
    const duplicated = bookOf([
      record('squat', { kilograms: 145 }),
      { ...record('squat', { kilograms: 150 }), id: 'a-second-squat-record' },
    ]);
    const cell = cellFor(reportFor(ANSWERED, { books: [[NATIONAL, duplicated]] }), 'squat');
    expect(cell.notices).toEqual([
      'More than one National record is published for Open Full power, so none can be shown.',
    ]);
    expect(titlesIn(cell)).toEqual(['Class III', 'Class II', 'Class I']);
  });

  /**
   * The same sentence arrives once per event, and the ambiguous-record one once
   * per division as well. Three identical lines under one lift reads as three
   * separate problems rather than one seen three times.
   */
  it('says each thing once however many loops produced it', () => {
    const duplicated = bookOf([
      record('squat', { kilograms: 145 }),
      { ...record('squat', { kilograms: 150 }), id: 'a-second-squat-record' },
    ]);
    const cell = cellFor(
      reportFor(FULLY_ANSWERED, {
        books: [
          [NORTH, duplicated],
          [NATIONAL, duplicated],
        ],
      }),
      'squat',
    );
    expect(cell.notices).toEqual([
      'More than one National record is published for Open Full power, so none can be shown.',
    ]);
  });

  /**
   * ...and the division a table is scoped to decides which of them it conflicts
   * under. An Open-only table and a tested-only table are equally specific for a
   * lifter in Open and cannot be told apart; under Masters 1 the first does not
   * apply at all, so there is nothing to choose between and no sentence to say.
   */
  it('reports a conflict only in the division it actually arises in', () => {
    const conflicting: ClassificationBook = {
      ...CLASSIFICATIONS,
      tables: [table('squat', { divisionId: 'open' }), table('squat', { tested: true })],
    };
    const cell = cellFor(reportFor(FULLY_ANSWERED, { classifications: conflicting }), 'squat');
    expect(cell.notices).toEqual([
      'More than one set of standards applies to Open, so none can be shown.',
    ]);
    expect(cell.rows.map((row) => [row.title, row.divisionLabel])).toEqual([
      ['Class III', 'Masters 1'],
      ['Class II', 'Masters 1'],
      ['National record', 'Open'],
      ['Class I', 'Masters 1'],
    ]);
  });

  /**
   * Open is found by shape rather than by name, so the only division a federation
   * publishes is the one everybody is eligible for whatever its band says. A
   * report that went looking for both bounds to be null would draw no Open column
   * here, and an empty column reads as a federation that keeps no open records.
   */
  it('takes the only division there is as the Open one', () => {
    const oneDivision: CategoryCatalog = {
      ...CATALOG,
      ageDivisions: {
        ...CATALOG.ageDivisions,
        divisions: [{ id: 'masters-1', label: 'Masters 1', minimumAge: 40, maximumAge: 49 }],
      },
    };
    const report = reportFor(ANSWERED, { catalog: oneDivision });
    expect(report.notices).toEqual([]);
    expect(cellFor(report, 'deadlift').rows).toHaveLength(3);
  });

  /**
   * The defensive branch, and the reason it is written out rather than folded
   * into the ambiguous one: `AgeDivisionsSchema` requires at least one division,
   * so a catalogue that parsed can never reach here. What can is an adapter bug
   * upstream of the parse, and this is what it degrades to -- a sentence saying
   * the Open column is missing, rather than a column that is simply not drawn.
   */
  it('says plainly when the published divisions are empty', () => {
    const noDivisions: CategoryCatalog = {
      ...CATALOG,
      ageDivisions: { ...CATALOG.ageDivisions, divisions: [] },
    };
    const report = reportFor(ANSWERED, { catalog: noDivisions });
    expect(report.notices).toEqual([
      'No Open division could be identified in the published divisions, so only the division you chose is shown.',
    ]);
  });

  it('says plainly when more than one division is as wide as every other', () => {
    const twoOpens: CategoryCatalog = {
      ...CATALOG,
      ageDivisions: {
        ...CATALOG.ageDivisions,
        divisions: [
          { id: 'open', label: 'Open', minimumAge: null, maximumAge: null },
          { id: 'all-comers', label: 'All comers', minimumAge: null, maximumAge: null },
        ],
      },
    };
    const report = reportFor(ANSWERED, { catalog: twoOpens });
    expect(report.notices).toEqual([
      'More than one published division is as wide as every other, so the Open division cannot be identified.',
    ]);
  });

  /**
   * A keyed render drops a duplicate silently, so a collision here is a record
   * simply missing from a report whose whole job is completeness. Built from the
   * loop rather than from a record's own identifier, which the contract does not
   * make unique across two partitions' artifacts.
   */
  it('gives every rung in the whole report a distinct identifier', () => {
    const report = reportFor(FULLY_ANSWERED, {
      books: [
        [NORTH, STATE_BOOK],
        [NATIONAL, BOOK],
      ],
    });
    const ids = everyRow(report).map((row) => row.id);
    expect(ids.length).toBeGreaterThan(20);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Two rungs at the same weight in an order that depends on which loop ran
   * first would reshuffle between renders, and a list that reorders under a
   * thumb is one a reader has to re-find their place in after every keystroke.
   */
  it('breaks a tie the same way every time, classification first', () => {
    const tied = bookOf([record('squat', { kilograms: 149.5 })]);
    const cell = cellFor(reportFor(ANSWERED, { books: [[NATIONAL, tied]] }), 'squat');
    const [, , third, fourth] = cell.rows;
    expect(third?.kilograms).toBe(150);
    expect(fourth?.kilograms).toBe(150);
    expect([third?.kind, fourth?.kind]).toEqual(['classification', 'record']);
  });

  it('produces the same report twice from the same inputs', () => {
    expect(reportFor(FULLY_ANSWERED)).toEqual(reportFor(FULLY_ANSWERED));
  });
});

/**
 * The cheap second pass.
 *
 * Separate from `buildReport` so a keystroke cannot invalidate the report:
 * building one walks every class by every division by every partition by every
 * event, and doing that on each character typed is the cost that only shows up
 * on the phone this was written for.
 */
describe('reachedIn', () => {
  const rows = cellFor(reportFor(ANSWERED), 'squat').rows;

  it('marks every rung at or below the lift', () => {
    // At or below: a standard is earned by reaching it, and a record target is
    // the weight that takes the record rather than the first weight past it.
    expect([...reachedIn(rows, 120)]).toEqual(rows.slice(0, 2).map((row) => row.id));
  });

  it('counts an exact hit as reached', () => {
    expect(reachedIn(rows, 145.5).size).toBe(3);
  });

  /**
   * `null` is nothing usable typed, which is not zero. An empty set renders as a
   * report with nothing struck through; treating it as zero would render as a
   * lifter who has reached nothing, which is a claim about them rather than
   * about what they have entered.
   */
  it('marks nothing when nothing usable was typed', () => {
    expect(reachedIn(rows, null).size).toBe(0);
  });
});

describe('nextIn', () => {
  const rows = cellFor(reportFor(ANSWERED), 'squat').rows;

  it('points at the first rung still ahead', () => {
    expect(nextIn(rows, 120)).toBe(rows[2]?.id);
  });

  it('points past an exactly-reached rung rather than at it', () => {
    expect(nextIn(rows, 100)).toBe(rows[1]?.id);
  });

  it('points at nothing once every rung is behind', () => {
    expect(nextIn(rows, 500)).toBeNull();
  });

  it('points at nothing when nothing usable was typed', () => {
    expect(nextIn(rows, null)).toBeNull();
  });
});
