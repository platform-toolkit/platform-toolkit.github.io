// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { AthleteEntry, ClassificationTable } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import type { ObservedStanding, ResolvedRegistration } from '../types.js';
import { collectStandings } from './history.js';
import { entry, TABLES_FIXTURE, wholeYearWindow } from './qualification.fixture.js';
import { gradeLift, gradeStanding, reportedLifts } from './standing.js';

const WINDOW = wholeYearWindow();

/** The registration the fixture's one full table was published for. */
const REGISTRATION: ResolvedRegistration = {
  sex: 'male',
  equipmentId: 'raw',
  weightClassId: 'to-94',
  divisionId: 'open',
  tested: true,
};

function standingFor(patch: Partial<AthleteEntry> = {}): ObservedStanding {
  const [first] = collectStandings([entry(patch)], WINDOW);
  if (first === undefined) throw new Error('Expected one entry to make one standing.');
  return first;
}

describe('gradeStanding', () => {
  const report = gradeStanding(standingFor(), REGISTRATION, TABLES_FIXTURE);

  it('reads the total against the table published for this registration', () => {
    expect(report.total).toMatchObject({
      kind: 'graded',
      classification: {
        achieved: { id: 'first', label: 'First Class', rank: 2, requiredKilograms: 546 },
        next: { id: 'elite', label: 'Elite', rank: 3, requiredKilograms: 618 },
        kilogramsToNext: 23,
      },
    });
  });

  it('names the table each grade came from, so the screen can cite it', () => {
    expect(report.total.kind === 'graded' && report.total.table.id).toBe(
      'total-raw-94-open-tested',
    );
  });

  it('reads a lift against a table that distinguishes on nothing', () => {
    // A `null` axis is the federation saying it does not split on that axis, so it
    // widens the table rather than excluding this lifter from it.
    expect(report.bench).toMatchObject({
      kind: 'graded',
      classification: { achieved: { id: 'second' }, next: { id: 'first' }, kilogramsToNext: 17 },
    });
  });

  it('carries the assumption it graded under on the report itself', () => {
    // A grade with no visible statement of which class, division and tested status it
    // was read under is a number a lifter cannot check, and cannot correct.
    expect(report.registration).toEqual(REGISTRATION);
  });

  it('says nothing at all about eligibility', () => {
    expect(Object.keys(report).sort()).toEqual([
      'bench',
      'deadlift',
      'registration',
      'squat',
      'total',
    ]);
  });
});

describe('the ways a lift can have no grade', () => {
  it('reports two equally specific tables rather than picking one', () => {
    // The failure this is guarding. Collapsed into "not qualified" it would be a real
    // answer nobody investigates -- and the two tables here disagree by 12 kg, so
    // whichever was transcribed first would decide whether somebody paid an entry fee.
    const report = gradeStanding(standingFor(), REGISTRATION, TABLES_FIXTURE);
    expect(report.squat).toMatchObject({ kind: 'ungraded', reason: 'ambiguous-standards' });
  });

  it('grades once one of those two tables stops matching', () => {
    // The same lifter in a different equipment category matches one table, not two.
    // Proof that the ambiguity above is a tie and not simply a failure to match.
    const report = gradeStanding(
      standingFor(),
      { ...REGISTRATION, equipmentId: 'single-ply' },
      TABLES_FIXTURE,
    );
    expect(report.squat).toMatchObject({ kind: 'graded' });
  });

  it('reports a category the federation publishes nothing for', () => {
    const report = gradeStanding(standingFor(), REGISTRATION, TABLES_FIXTURE);
    expect(report.deadlift).toMatchObject({ kind: 'ungraded', reason: 'no-standards' });
  });

  it('keeps the figure beside the reason, so an ungraded lift is still shown', () => {
    const report = gradeStanding(standingFor(), REGISTRATION, TABLES_FIXTURE);
    expect(report.deadlift.best?.kilograms).toBe(250);
  });

  it('blames the window before it blames the data', () => {
    // Checked before the table is looked up, so a lifter with no bench sees "no bench
    // in this window" rather than a complaint about the federation's records. The two
    // read identically on screen and only one of them is theirs to fix.
    expect(gradeLift(null, 'deadlift', REGISTRATION, [])).toEqual({
      kind: 'ungraded',
      reason: 'no-result',
      best: null,
    });
  });

  it('reads a published table that is not a ladder as no standards', () => {
    // A data fault, and this screen is not where it gets reported. From where the
    // lifter is standing there are no usable standards, which is what it says.
    const broken: readonly ClassificationTable[] = [
      {
        id: 'total-mistranscribed',
        label: 'Total, mistranscribed',
        scope: {
          sex: 'male',
          lift: 'total',
          equipmentId: null,
          weightClassId: null,
          divisionId: null,
          tested: null,
        },
        // The ranks ascend and the totals do not, which is the transcription error
        // `ClassificationLadder` exists to refuse: sorting by either alone would
        // produce a plausible order and award a title nobody earned.
        standards: [
          { id: 'third', label: 'Third Class', rank: 0, requiredKilograms: 471 },
          { id: 'second', label: 'Second Class', rank: 1, requiredKilograms: 403 },
        ],
      },
    ];
    expect(gradeStanding(standingFor(), REGISTRATION, broken).total).toMatchObject({
      kind: 'ungraded',
      reason: 'no-standards',
    });
  });
});

describe('a total made from fewer than three lifts', () => {
  it('is never graded against a three-lift standard', () => {
    // End to end, because this is the one wrong answer that would be heavier than the
    // right one. A 410 kg push/pull total is above two rungs of the fixture ladder.
    const standing = standingFor({
      event: 'BD',
      squatKg: null,
      benchKg: 150,
      deadliftKg: 260,
      totalKg: 410,
    });
    const report = gradeStanding(standing, REGISTRATION, TABLES_FIXTURE);
    expect(report.total).toEqual({ kind: 'ungraded', reason: 'no-result', best: null });
    expect(standing.partialTotal?.kilograms).toBe(410);
  });
});

describe('reportedLifts', () => {
  it('is the order a scoresheet prints them', () => {
    expect(reportedLifts()).toEqual(['squat', 'bench', 'deadlift', 'total']);
  });

  it('covers every lift the report carries', () => {
    const report = gradeStanding(standingFor(), REGISTRATION, TABLES_FIXTURE);
    for (const lift of reportedLifts()) {
      expect(report[lift]).toBeDefined();
    }
  });
});
