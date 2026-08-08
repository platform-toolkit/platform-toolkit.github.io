// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  CategoryCatalog,
  ClassificationBook,
  FederationRecord,
  Lift,
  RecordBook,
} from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  NOT_PUBLISHED,
  NO_RECORD_YET,
  buildReport,
  nextIn,
  reachedIn,
  type LiftTargets,
  type Matrix,
  type MatrixCell,
  type MatrixRow,
  type RecordDetail,
  type Report,
  type TargetGroup,
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
} from './records.fixture.js';
import { partitionKey, resolveSelection } from './selection.js';
import type { CategorySelection, RecordPartition } from '../types.js';
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

function targetsFor(report: Report, lift: Lift): LiftTargets {
  const targets = report.lifts.find((candidate) => candidate.lift === lift);
  if (targets === undefined) {
    throw new Error(`The report has no ${lift}.`);
  }
  return targets;
}

function matricesIn(groups: readonly TargetGroup[]): readonly Matrix[] {
  return groups.flatMap((group) => group.matrices);
}

function rowsIn(groups: readonly TargetGroup[]): readonly MatrixRow[] {
  return matricesIn(groups).flatMap((matrix) => matrix.rows);
}

function cellsIn(groups: readonly TargetGroup[]): readonly MatrixCell[] {
  return rowsIn(groups).flatMap((row) => row.cells);
}

function cellAt(row: MatrixRow, weightClassId: string): MatrixCell {
  const cell = row.cells.find((candidate) => candidate.weightClass.id === weightClassId);
  if (cell === undefined) {
    throw new Error(`Row "${row.id}" has no "${weightClassId}" column.`);
  }
  return cell;
}

function captionsIn(groups: readonly TargetGroup[]): string[] {
  return matricesIn(groups).map((matrix) => matrix.caption);
}

function labelsIn(groups: readonly TargetGroup[]): string[] {
  return rowsIn(groups).map((row) => row.label);
}

/** One column's figures, in row order, with `null` where nothing is published. */
function valuesIn(groups: readonly TargetGroup[], weightClassId = 'f-56'): (number | null)[] {
  return rowsIn(groups).map((row) => cellAt(row, weightClassId).value?.kilograms ?? null);
}

function firstDetail(groups: readonly TargetGroup[], weightClassId = 'f-56'): RecordDetail {
  const detail = cellsIn(groups).find(
    (cell) => cell.weightClass.id === weightClassId && cell.detail !== null,
  )?.detail;
  if (detail === undefined || detail === null) {
    throw new Error(`No record detail in the "${weightClassId}" column.`);
  }
  return detail;
}

/** Both families at once, which is what the whole-report passes walk. */
function everyGroup(report: Report): readonly TargetGroup[] {
  return report.lifts.flatMap((targets) => [...targets.classifications, ...targets.records]);
}

/** A copy of a fixture record moved into another weight class. */
function inClass(base: FederationRecord, weightClassId: string, id: string): FederationRecord {
  return { ...base, id, scope: { ...base.scope, weightClassId } };
}

describe('buildReport', () => {
  it('has a lift per platform lift even before anything is answered', () => {
    // The element draws its lift bar from this, and a report that returned
    // nothing at all would make the whole screen appear after the last read
    // instead of filling in -- which on gym signal is most of a minute of blank
    // page.
    const report = reportFor({
      sex: null,
      equipment: null,
      weightClass: null,
      comparisonWeightClass: null,
      division: null,
      tested: null,
      region: null,
    });
    expect(report.lifts.map((targets) => targets.label)).toEqual([
      'Squat',
      'Bench press',
      'Deadlift',
      'Total',
    ]);
    expect(report.weightClasses).toEqual([]);
    expect(report.divisions).toEqual([]);
    expect(everyGroup(report)).toEqual([]);
  });

  /**
   * Requirement 9's other half, and the reason the report is worth building: the
   * optional answers add columns, so a report drawn from the four required ones
   * is complete rather than provisional.
   */
  it('is a whole report from the required answers alone', () => {
    const report = reportFor(ANSWERED);
    expect(report.weightClasses.map((weightClass) => weightClass.id)).toEqual(['f-56']);
    expect(cellsIn(everyGroup(report)).length).toBeGreaterThan(0);
  });

  /**
   * Requirement 7. All of them, not the next one -- a lifter deciding what to
   * open with wants the whole ladder in front of them, and the old panel's
   * "next classification" sentence was one rung of it.
   */
  it('shows every classification level the federation publishes', () => {
    expect(labelsIn(targetsFor(reportFor(ANSWERED), 'deadlift').classifications)).toEqual([
      'Class III',
      'Class II',
      'Class I',
    ]);
  });

  /**
   * The change this rebuild is: the two families are two sets of matrices rather
   * than one merged ladder. A lifter asks "where am I in the classifications" or
   * "what records could I take" -- never both in one scroll -- and merging them
   * put 182 rows on one page for an ordinary category.
   */
  it('keeps classifications and records in separate matrices', () => {
    const squat = targetsFor(reportFor(ANSWERED), 'squat');
    expect(captionsIn(squat.classifications)).toEqual(['Classification standards']);
    expect(valuesIn(squat.classifications)).toEqual([100, 120, 150]);
    expect(captionsIn(squat.records)).toEqual(['National records']);
    expect(valuesIn(squat.records)).toEqual([145]);
  });

  /**
   * A cell prints the record; a lifter is measured against the weight that
   * *takes* it. Collapsing the two either prints a figure the federation did not
   * publish, or marks a record reached by a lift that only equalled it.
   */
  it('prints the record and measures against the weight that takes it', () => {
    const [cell] = cellsIn(targetsFor(reportFor(ANSWERED), 'squat').records);
    expect(cell?.value?.kilograms).toBe(145);
    expect(cell?.thresholdKilograms).toBe(145.5);
  });

  /**
   * Requirement 5. Both units on every figure, converted with the exact factor --
   * not the federation's own truncated one, which exists to reproduce a
   * classification calculator and would put its arithmetic on another
   * federation's records.
   */
  it('writes every weight in kilograms and in pounds', () => {
    const squat = targetsFor(reportFor(ANSWERED), 'squat');
    const [standard] = cellsIn(squat.classifications);
    expect(standard?.value?.kilogramsText).toBe('100');
    expect(standard?.value?.poundsText).toBe('220.5');

    const detail = firstDetail(squat.records);
    expect(detail.record.kilogramsText).toBe('145');
    expect(detail.attempts[0]?.kilogramsText).toBe('145.5');
    expect(detail.attempts[0]?.poundsText).toBe('320.8');
  });

  /**
   * Requirement 4. The old panel asked which event and showed one; a lifter
   * planning a meet wants the ones they might enter as well as the one they are
   * entered in. The event is a group heading rather than part of every caption,
   * so it is said once per family instead of once per table.
   */
  it('covers every event the federation contests, without asking which', () => {
    const benchBook = bookOf([
      record('bench', { kilograms: 82.5 }),
      record('bench', { kilograms: 84, disciplineId: 'bench-only' }),
      record('bench', { kilograms: 83, disciplineId: 'push-pull' }),
    ]);
    const bench = targetsFor(reportFor(ANSWERED, { books: [[NATIONAL, benchBook]] }), 'bench');
    expect(bench.records.map((group) => group.heading)).toEqual([
      'Full power',
      'Bench only',
      'Push pull',
    ]);
    expect(valuesIn(bench.records)).toEqual([82.5, 84, 83]);
  });

  /**
   * ...but only the lifts each event actually contests. A bench-only meet has no
   * squat record, and a matrix saying none stands would be true of a record that
   * cannot exist -- which reads as a hole in the published data.
   */
  it('never invents a lift an event does not contest', () => {
    const stray = bookOf([
      record('squat', { kilograms: 145 }),
      record('squat', { kilograms: 200, disciplineId: 'bench-only' }),
    ]);
    const squat = targetsFor(reportFor(ANSWERED, { books: [[NATIONAL, stray]] }), 'squat');
    expect(squat.records.map((group) => group.id)).toEqual(['records:squat:full-power']);
    expect(valuesIn(squat.records)).toEqual([145]);
  });

  /**
   * A heading over one group is a heading that says nothing. Decided after the
   * groups are built rather than from the count of published events, because the
   * squat is contested by one of the three -- so a heading chosen up front would
   * print "Full power" over the squat's only group and nothing over the bench's
   * first of two.
   */
  it('drops the event heading when one event contests the lift', () => {
    expect(targetsFor(reportFor(ANSWERED), 'squat').records.map((group) => group.heading)).toEqual([
      null,
    ]);
  });

  /**
   * Requirement 3. World and national records are always shown; a state is
   * optional and adds to them rather than replacing them. This catalogue's
   * national level is not subdivided and its state level is, so answering the
   * region is exactly what turns one partition into two.
   */
  it('shows the unsubdivided levels with no region answered', () => {
    expect(captionsIn(targetsFor(reportFor(ANSWERED), 'squat').records)).toEqual([
      'National records',
    ]);
  });

  it('adds the state records to them once a state is answered', () => {
    const report = reportFor(FULLY_ANSWERED, {
      books: [
        [NORTH, STATE_BOOK],
        [NATIONAL, BOOK],
      ],
    });
    const squat = targetsFor(report, 'squat');
    // Closest to home first, which is the order a lifter plans in: the state
    // record is the one they might take this year.
    expect(captionsIn(squat.records)).toEqual(['North Example State records', 'National records']);
    expect(valuesIn(squat.records)).toEqual([null, 130, null, 145]);
  });

  /**
   * Requirement 8, and the shape the whole rebuild turns on. The two figures a
   * lifter asked to compare are two cells of one row, rather than two ordered
   * lists in two columns that they had to scroll between.
   */
  it('draws a column per weight class, in ladder order, in every matrix', () => {
    const report = reportFor(FULLY_ANSWERED);
    expect(report.weightClasses.map((weightClass) => weightClass.id)).toEqual(['f-52', 'f-56']);
    for (const matrix of matricesIn(everyGroup(report))) {
      expect(matrix.weightClasses.map((weightClass) => weightClass.id)).toEqual(['f-52', 'f-56']);
      for (const row of matrix.rows) {
        expect(row.cells.map((cell) => cell.weightClass.id)).toEqual(['f-52', 'f-56']);
      }
    }
  });

  it('keeps a record out of the class it was not set in', () => {
    // The fixture's records are all f-56. An f-52 column carrying them would be
    // the worst available failure on a screen whose whole job is matching a
    // category exactly.
    const squat = targetsFor(reportFor(FULLY_ANSWERED), 'squat');
    expect(valuesIn(squat.records, 'f-52')).toEqual([null, null]);
    expect(valuesIn(squat.records, 'f-56')).toEqual([null, 145]);
  });

  /**
   * Requirement 2. Open is always drawn and the chosen band is drawn beside it,
   * which is what makes the age question optional rather than load-bearing.
   *
   * Adjacent, in one group, chosen division first: the row a lifter came to read
   * is their own, and a matrix that opens on Open makes them look past it every
   * time.
   */
  it('puts the chosen division and Open on adjacent rows, chosen first', () => {
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
    expect(report.divisions.map((division) => division.id)).toEqual(['masters-1', 'open']);

    const rows = rowsIn(targetsFor(report, 'squat').records);
    expect(rows.map((row) => [row.label, row.divisionLabel])).toEqual([
      ['National record', 'Masters 1'],
      ['National record', 'Open'],
    ]);
    expect(new Set(rows.map((row) => row.groupId)).size).toBe(1);
    expect(valuesIn(targetsFor(report, 'squat').records)).toEqual([118, 145]);
  });

  /**
   * One division on screen, no division label. Naming it on every row would
   * repeat the one thing the whole report is already about.
   */
  it('leaves the division unlabelled when only one is shown', () => {
    const rows = rowsIn(targetsFor(reportFor(ANSWERED), 'squat').classifications);
    expect(rows.map((row) => row.divisionLabel)).toEqual([null, null, null]);
  });

  /**
   * A level a division publishes nothing for is dropped rather than printed as a
   * line of "Not published". A federation that keeps no Elite standard for a
   * masters division is the ordinary case, and saying so once per division per
   * level would be most of the table.
   */
  it('drops a row no class on it publishes anything for', () => {
    const perDivision: ClassificationBook = {
      ...CLASSIFICATIONS,
      tables: [
        table('squat', { divisionId: 'open' }),
        table('squat', { divisionId: 'masters-1' }, [
          { id: 'third', label: 'Class III', rank: 0, requiredKilograms: 90 },
        ]),
      ],
    };
    const rows = rowsIn(
      targetsFor(reportFor(FULLY_ANSWERED, { classifications: perDivision }), 'squat')
        .classifications,
    );
    expect(
      rows.map((row) => [row.label, row.divisionLabel, cellAt(row, 'f-56').value?.kilograms]),
    ).toEqual([
      ['Class III', 'Masters 1', 90],
      ['Class III', 'Open', 100],
      ['Class II', 'Open', 120],
      ['Class I', 'Open', 150],
    ]);
  });

  /**
   * ...and a cell with nothing behind it says so in words rather than as a zero
   * or a dash, both of which read as a figure -- and a zero is a target every
   * lifter has already beaten.
   */
  it('says what an empty cell means rather than printing a number for it', () => {
    const oneClassOnly: ClassificationBook = {
      ...CLASSIFICATIONS,
      tables: [table('squat', { weightClassId: 'f-56' })],
    };
    const report = reportFor(FULLY_ANSWERED, { classifications: oneClassOnly });
    const squat = targetsFor(report, 'squat');

    const [unpublished] = cellsIn(squat.classifications);
    expect(unpublished?.weightClass.id).toBe('f-52');
    expect(unpublished?.value).toBeNull();
    expect(unpublished?.emptyLabel).toBe(NOT_PUBLISHED);

    // A record cell gets the other sentence, and it is the more useful of the
    // two: a category with no record standing is one where the first qualifying
    // lift sets it.
    const [noRecord] = cellsIn(squat.records);
    expect(noRecord?.value).toBeNull();
    expect(noRecord?.emptyLabel).toBe(NO_RECORD_YET);
  });

  /**
   * A whole scope with no record anywhere in it is dropped. Otherwise three
   * levels by three events is nine tables of "None yet" for a lifter whose
   * category simply has no state records -- the sprawl this rebuild removes.
   */
  it('drops a matrix nothing in it is published for', () => {
    const report = reportFor(FULLY_ANSWERED, {
      books: [
        [NORTH, bookOf([])],
        [NATIONAL, BOOK],
      ],
    });
    expect(captionsIn(targetsFor(report, 'squat').records)).toEqual(['National records']);
  });

  /**
   * A cell in a table is announced with its row and column headings, but the
   * lift, the scope and the division live in the caption and the bar above it,
   * and a reader who jumps straight to a value hears none of them.
   */
  it('names every cell with the whole context it sits in', () => {
    const answered = targetsFor(reportFor(ANSWERED), 'squat');
    expect(cellsIn(answered.classifications)[0]?.accessibleName).toBe(
      'Class III, 56 kg: 100 kilograms',
    );

    const compared = targetsFor(reportFor(FULLY_ANSWERED), 'squat');
    const named = cellsIn(compared.records).find((cell) => cell.value !== null);
    expect(named?.accessibleName).toBe('National record, Full power, Open, 56 kg: 145 kilograms');
    expect(named?.detail?.scopeLabel).toBe('National record, Full power, Open, 56 kg');
  });

  /**
   * Requirement 12's data half, carried onto the cell the disclosure links from.
   * Assembled URLs are refused a layer down; this only checks the book's own
   * table reaches the detail.
   */
  it('carries the federation’s own table link onto the record', () => {
    expect(firstDetail(targetsFor(reportFor(ANSWERED), 'squat').records).sourceUrl).toBe(
      'https://records.example.test/records?level=national&event=raw-full-power',
    );
  });

  it('carries no link for a scope the book lists no table for', () => {
    const report = reportFor(FULLY_ANSWERED, { books: [[NORTH, STATE_BOOK]] });
    expect(firstDetail(targetsFor(report, 'squat').records).sourceUrl).toBeNull();
  });

  /**
   * Requirement 6 arriving in the detail. Both conditions, because the rule turns
   * on the level of the meet entered and this application cannot see which meet
   * that is -- naming one figure with no condition is the wrong number at every
   * meet held above the record's own level.
   */
  it('gives each record both of the weights that could take it', () => {
    const detail = firstDetail(targetsFor(reportFor(ANSWERED), 'squat').records);
    expect(detail.attempts.map((attempt) => [attempt.condition, attempt.kilograms])).toEqual([
      ['At a meet of this level or below', 145.5],
      ['At a meet above this level', 147.5],
    ]);
    // Measured from the two figures on screen rather than described in prose, so
    // a federation publishing a different margin cannot be contradicted by a
    // sentence naming this one.
    expect(detail.attempts.map((attempt) => attempt.basis)).toEqual([
      'Exceeds the record by 0.5 kg',
      'Exceeds the record by 2.5 kg',
    ]);
  });

  it('reports who holds a record, in the date the federation published', () => {
    const detail = firstDetail(targetsFor(reportFor(ANSWERED), 'squat').records);
    expect(detail.holder).toEqual({
      name: 'Robin Vance',
      achievedOn: '2024-05-18',
      meetName: 'Example Winter Open',
    });
    expect(detail.unclaimed).toBe(false);
  });

  /**
   * A seeded record is a record with an invitation attached, not a gap in the
   * data. The two want opposite sentences, so they are separate fields rather
   * than an absent holder standing in for both.
   */
  it('distinguishes a record nobody holds from one whose holder was not published', () => {
    const seeded = bookOf([record('squat', { kilograms: 145, unclaimed: true })]);
    const seededDetail = firstDetail(
      targetsFor(reportFor(ANSWERED, { books: [[NATIONAL, seeded]] }), 'squat').records,
    );
    expect(seededDetail.unclaimed).toBe(true);
    expect(seededDetail.holder).toBeNull();

    const anonymous = bookOf([
      record('squat', { kilograms: 145, holderName: null, achievedOn: null, meetName: null }),
    ]);
    const anonymousDetail = firstDetail(
      targetsFor(reportFor(ANSWERED, { books: [[NATIONAL, anonymous]] }), 'squat').records,
    );
    expect(anonymousDetail.unclaimed).toBe(false);
    expect(anonymousDetail.holder).toBeNull();
  });

  /**
   * The reason the input takes a map rather than a list: the reads settle
   * independently, and a report that waited for the last one would be blank for
   * the whole time a phone on gym signal is doing the work.
   */
  it('draws the partitions that have arrived and leaves room for the rest', () => {
    const report = reportFor(FULLY_ANSWERED, { books: [[NATIONAL, BOOK]] });
    expect(captionsIn(targetsFor(report, 'squat').records)).toEqual(['National records']);
  });

  it('treats a partition published with no book the same as one not yet read', () => {
    const report = reportFor(FULLY_ANSWERED, {
      books: [
        [NORTH, null],
        [NATIONAL, BOOK],
      ],
    });
    expect(captionsIn(targetsFor(report, 'squat').records)).toEqual(['National records']);
  });

  it('still draws the records when no classifications are published', () => {
    const squat = targetsFor(reportFor(ANSWERED, { classifications: null }), 'squat');
    expect(squat.classifications).toEqual([]);
    expect(valuesIn(squat.records)).toEqual([145]);
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
    const squat = targetsFor(reportFor(ANSWERED, { classifications: conflicting }), 'squat');
    expect(squat.classificationNotices).toEqual([
      'More than one set of standards applies to Open, so none can be shown.',
    ]);
    expect(squat.classifications).toEqual([]);
    // The other family is untouched: an unreadable standard says nothing about a
    // record, and blanking both would hide data that arrived intact.
    expect(valuesIn(squat.records)).toEqual([145]);
  });

  it('refuses to choose between two records for one category', () => {
    const duplicated = bookOf([
      record('squat', { kilograms: 145 }),
      { ...record('squat', { kilograms: 150 }), id: 'a-second-squat-record' },
    ]);
    const squat = targetsFor(reportFor(ANSWERED, { books: [[NATIONAL, duplicated]] }), 'squat');
    expect(squat.recordNotices).toEqual([
      'More than one National record is published for Open Full power, so none can be shown.',
    ]);
    expect(squat.records).toEqual([]);
    expect(valuesIn(squat.classifications)).toEqual([100, 120, 150]);
  });

  /**
   * The same sentence arrives once per weight class, and once per event as well.
   * Three identical lines under one lift reads as three separate problems rather
   * than one seen three times.
   */
  it('says each thing once however many loops produced it', () => {
    const light = record('squat', { kilograms: 140 });
    const duplicated = bookOf([
      record('squat', { kilograms: 145 }),
      { ...record('squat', { kilograms: 150 }), id: 'a-second-f-56-squat-record' },
      inClass(light, 'f-52', 'an-f-52-squat-record'),
      inClass(light, 'f-52', 'a-second-f-52-squat-record'),
    ]);
    const squat = targetsFor(
      reportFor(FULLY_ANSWERED, { books: [[NATIONAL, duplicated]] }),
      'squat',
    );
    expect(squat.recordNotices).toEqual([
      'More than one National record is published for Open Full power, so none can be shown.',
    ]);
  });

  /**
   * ...and the division a table is scoped to decides which of them it conflicts
   * under. An Open-only table and a tested-only table are equally specific for a
   * lifter in Open and cannot be told apart; under Masters 1 the first does not
   * apply at all, so there is nothing to choose between and no sentence to say.
   *
   * The class is named because two are on screen. With one it would repeat the
   * class the whole report is about; with two, a conflict in only one of them is
   * a sentence a reader has to be able to attach to a column.
   */
  it('reports a conflict only in the division and class it actually arises in', () => {
    const conflicting: ClassificationBook = {
      ...CLASSIFICATIONS,
      tables: [table('squat', { divisionId: 'open' }), table('squat', { tested: true })],
    };
    const squat = targetsFor(reportFor(FULLY_ANSWERED, { classifications: conflicting }), 'squat');
    expect(squat.classificationNotices).toEqual([
      'More than one set of standards applies to Open in the 52 kg class, so none can be shown.',
      'More than one set of standards applies to Open in the 56 kg class, so none can be shown.',
    ]);
    expect(rowsIn(squat.classifications).map((row) => [row.label, row.divisionLabel])).toEqual([
      ['Class III', 'Masters 1'],
      ['Class II', 'Masters 1'],
      ['Class I', 'Masters 1'],
    ]);
  });

  /**
   * Open is found by shape rather than by name, so the only division a federation
   * publishes is the one everybody is eligible for whatever its band says. A
   * report that went looking for both bounds to be null would draw no Open row
   * here, and an empty table reads as a federation that keeps no open records.
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
    expect(rowsIn(targetsFor(report, 'deadlift').classifications)).toHaveLength(3);
  });

  /**
   * The defensive branch, and the reason it is written out rather than folded
   * into the ambiguous one: `AgeDivisionsSchema` requires at least one division,
   * so a catalogue that parsed can never reach here. What can is an adapter bug
   * upstream of the parse, and this is what it degrades to -- a sentence saying
   * the Open row is missing, rather than a row that is simply not drawn.
   */
  it('says plainly when the published divisions are empty', () => {
    const noDivisions: CategoryCatalog = {
      ...CATALOG,
      ageDivisions: { ...CATALOG.ageDivisions, divisions: [] },
    };
    expect(reportFor(ANSWERED, { catalog: noDivisions }).notices).toEqual([
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
    expect(reportFor(ANSWERED, { catalog: twoOpens }).notices).toEqual([
      'More than one published division is as wide as every other, so the Open division cannot be identified.',
    ]);
  });

  /**
   * A keyed render drops a duplicate silently, so a collision here is a cell
   * simply missing from a report whose whole job is completeness. Built from the
   * loop rather than from a record's own identifier, which the contract does not
   * make unique across two partitions' artifacts.
   */
  it('gives every cell, row and matrix in the whole report a distinct identifier', () => {
    const report = reportFor(FULLY_ANSWERED, {
      books: [
        [NORTH, STATE_BOOK],
        [NATIONAL, BOOK],
      ],
    });
    const groups = everyGroup(report);

    const cellIds = cellsIn(groups).map((cell) => cell.id);
    expect(cellIds.length).toBeGreaterThan(20);
    expect(new Set(cellIds).size).toBe(cellIds.length);

    const rowIds = rowsIn(groups).map((row) => row.id);
    expect(new Set(rowIds).size).toBe(rowIds.length);

    const matrixIds = matricesIn(groups).map((matrix) => matrix.id);
    expect(new Set(matrixIds).size).toBe(matrixIds.length);
  });

  /**
   * Rows sharing a group are what the element draws as one `tbody`, so a group
   * split by a row from another one would put a rule through the middle of the
   * pair a lifter is comparing.
   */
  it('keeps the rows of one group together', () => {
    const report = reportFor(FULLY_ANSWERED, {
      books: [
        [NORTH, STATE_BOOK],
        [NATIONAL, BOOK],
      ],
    });
    for (const matrix of matricesIn(everyGroup(report))) {
      const order = matrix.rows.map((row) => row.groupId);
      const runs = order.filter((groupId, index) => groupId !== order[index - 1]);
      expect(new Set(runs).size).toBe(runs.length);
    }
  });

  /** Ascending, so the ladder reads the way a lifter climbs it. */
  it('orders the classification levels by their published rank', () => {
    const shuffled: ClassificationBook = {
      ...CLASSIFICATIONS,
      tables: [
        table('squat', {}, [
          { id: 'first', label: 'Class I', rank: 2, requiredKilograms: 150 },
          { id: 'third', label: 'Class III', rank: 0, requiredKilograms: 100 },
          { id: 'second', label: 'Class II', rank: 1, requiredKilograms: 120 },
        ]),
      ],
    };
    const squat = targetsFor(reportFor(ANSWERED, { classifications: shuffled }), 'squat');
    expect(valuesIn(squat.classifications)).toEqual([100, 120, 150]);
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
function squatGroups(selection: CategorySelection = ANSWERED): readonly TargetGroup[] {
  const squat = targetsFor(reportFor(selection), 'squat');
  return [...squat.classifications, ...squat.records];
}

/** The thresholds behind a set of marked cells, ascending, for a readable assertion. */
function thresholdsOf(
  groups: readonly TargetGroup[],
  marked: ReadonlySet<string>,
): (number | null)[] {
  return cellsIn(groups)
    .filter((cell) => marked.has(cell.id))
    .map((cell) => cell.thresholdKilograms)
    .toSorted((left, right) => (left ?? 0) - (right ?? 0));
}

describe('reachedIn', () => {
  const groups = squatGroups();

  it('marks every target at or below the lift', () => {
    // At or below: a standard is earned by reaching it, and a record target is
    // the weight that takes the record rather than the first weight past it.
    expect(thresholdsOf(groups, reachedIn(groups, 120))).toEqual([100, 120]);
  });

  it('counts an exact hit as reached', () => {
    expect(thresholdsOf(groups, reachedIn(groups, 145.5))).toEqual([100, 120, 145.5]);
  });

  /**
   * `null` is nothing usable typed, which is not zero. An empty set renders as a
   * report with nothing marked; treating it as zero would render as a lifter who
   * has reached nothing, which is a claim about them rather than about what they
   * have entered.
   */
  it('marks nothing when nothing usable was typed', () => {
    expect(reachedIn(groups, null).size).toBe(0);
  });
});

describe('nextIn', () => {
  const groups = squatGroups();

  it('points at the nearest target still ahead', () => {
    expect(thresholdsOf(groups, nextIn(groups, 120))).toEqual([145.5]);
  });

  it('points past an exactly-reached target rather than at it', () => {
    expect(thresholdsOf(groups, nextIn(groups, 100))).toEqual([120]);
  });

  it('points at nothing once every target is behind', () => {
    expect(nextIn(groups, 500).size).toBe(0);
  });

  it('points at nothing when nothing usable was typed', () => {
    expect(nextIn(groups, null).size).toBe(0);
  });

  /**
   * One per column, which is the change the matrix forced. With two classes side
   * by side, marking a single nearest cell would point a lifter at the class they
   * are cutting to while their own column said nothing.
   */
  it('points at one target in each weight class', () => {
    const compared = squatGroups(FULLY_ANSWERED);
    const marked = nextIn(compared, 120);
    expect(thresholdsOf(compared, marked)).toEqual([145.5, 150]);
    expect(
      cellsIn(compared)
        .filter((cell) => marked.has(cell.id))
        .map((cell) => cell.weightClass.id),
    ).toEqual(['f-52', 'f-56']);
  });
});
